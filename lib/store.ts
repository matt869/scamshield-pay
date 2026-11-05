import fs from "node:fs";
import path from "node:path";
import type { CheckRecord } from "./types";

/**
 * A JSON file behind an in-memory copy. It suits one long-running server process with a
 * persistent disk. For several instances or serverless hosting, replace this module with a
 * database; nothing else in the app touches the file.
 *
 * Messages are sensitive, so records expire: see the TTLs below.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const UNPAID_TTL_MS = DAY_MS;
export const PAID_TTL_MS = 30 * DAY_MS;

export interface OrderRef {
  checkId: string;
  amount: string;
  currency: string;
}

export interface InvoiceRef {
  checkId: string;
  amount: string;
  currency: string;
}

interface StoreData {
  checks: Record<string, CheckRecord>;
  orders: Record<string, OrderRef>;
  invoices: Record<string, InvoiceRef>;
  /** PayPal capture ID to check ID, so refunds can find what they reverse. */
  captures: Record<string, string>;
}

interface StoreState {
  file: string;
  data: StoreData;
  loaded: boolean;
  writeQueue: Promise<void>;
  persistenceDisabled: boolean;
}

function emptyData(): StoreData {
  return { checks: {}, orders: {}, invoices: {}, captures: {} };
}

// On globalThis because Next.js can bundle this module once per route.
const globalForStore = globalThis as typeof globalThis & { __scamshieldStore?: StoreState };

function state(): StoreState {
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.STORE_FILE || ".data/store.json");
  let current = globalForStore.__scamshieldStore;
  if (!current || current.file !== file) {
    current = { file, data: emptyData(), loaded: false, writeQueue: Promise.resolve(), persistenceDisabled: false };
    globalForStore.__scamshieldStore = current;
  }
  if (!current.loaded) {
    current.loaded = true;
    try {
      current.data = { ...emptyData(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // A damaged file must not be overwritten, because it may hold payment records.
        current.persistenceDisabled = true;
        console.error("store: could not read the store file; keeping it untouched and running from memory");
      }
    }
  }
  return current;
}

function persist(current: StoreState): Promise<void> {
  if (current.persistenceDisabled) return Promise.resolve();
  const snapshot = JSON.stringify(current.data);
  current.writeQueue = current.writeQueue.then(async () => {
    try {
      await fs.promises.mkdir(path.dirname(current.file), { recursive: true });
      const temp = `${current.file}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, snapshot, { mode: 0o600 });
      await fs.promises.rename(temp, current.file);
    } catch (error) {
      current.persistenceDisabled = true;
      console.error(
        `store: cannot write the store file (${(error as NodeJS.ErrnoException).code ?? "unknown"}); ` +
          "running from memory, and records will be lost on restart",
      );
    }
  });
  return current.writeQueue;
}

function purgeExpired(current: StoreState, now: number): void {
  const { checks, orders, invoices, captures } = current.data;
  for (const [id, check] of Object.entries(checks)) {
    if (check.expiresAt <= now) delete checks[id];
  }
  for (const [id, ref] of Object.entries(orders)) {
    if (!checks[ref.checkId]) delete orders[id];
  }
  for (const [id, ref] of Object.entries(invoices)) {
    if (!checks[ref.checkId]) delete invoices[id];
  }
  for (const [id, checkId] of Object.entries(captures)) {
    if (!checks[checkId]) delete captures[id];
  }
}

export async function saveCheck(record: CheckRecord): Promise<void> {
  const current = state();
  purgeExpired(current, Date.now());
  current.data.checks[record.id] = record;
  await persist(current);
}

export function getCheck(id: string, now = Date.now()): CheckRecord | null {
  const check = state().data.checks[id];
  return check && check.expiresAt > now ? check : null;
}

/** Applies a change to a check and saves it. Returns null when the check is gone. */
export async function updateCheck(
  id: string,
  change: (check: CheckRecord) => void,
): Promise<CheckRecord | null> {
  const current = state();
  const check = getCheck(id);
  if (!check) return null;
  change(check);
  await persist(current);
  return check;
}

export async function rememberOrder(orderId: string, ref: OrderRef): Promise<void> {
  const current = state();
  current.data.orders[orderId] = ref;
  await persist(current);
}

export function getOrderRef(orderId: string): OrderRef | null {
  return state().data.orders[orderId] ?? null;
}

export async function rememberInvoice(invoiceId: string, ref: InvoiceRef): Promise<void> {
  const current = state();
  current.data.invoices[invoiceId] = ref;
  await persist(current);
}

export function getInvoiceRef(invoiceId: string): InvoiceRef | null {
  return state().data.invoices[invoiceId] ?? null;
}

export function getCheckIdForCapture(captureId: string): string | null {
  return state().data.captures[captureId] ?? null;
}

/**
 * Grants the kit. A revoked payment stays revoked, so a retried "completed" webhook arriving
 * after a refund cannot hand the kit back.
 */
export async function markPaid(checkId: string, captureId?: string): Promise<CheckRecord | null> {
  const current = state();
  if (captureId) current.data.captures[captureId] = checkId;
  return updateCheck(checkId, (check) => {
    if (check.paymentStatus === "revoked") return;
    if (check.paymentStatus !== "paid") check.paidAt = Date.now();
    check.paymentStatus = "paid";
    check.expiresAt = Math.max(check.expiresAt, Date.now() + PAID_TTL_MS);
  });
}

export async function markRevoked(checkId: string): Promise<CheckRecord | null> {
  return updateCheck(checkId, (check) => {
    check.paymentStatus = "revoked";
  });
}

/** Keeps a check alive long enough for someone to pay an emailed invoice. */
export async function extendForInvoice(checkId: string): Promise<CheckRecord | null> {
  return updateCheck(checkId, (check) => {
    check.invoicesSent += 1;
    check.expiresAt = Math.max(check.expiresAt, Date.now() + PAID_TTL_MS);
  });
}

/** Test helper: flushes pending writes. */
export function storeIdle(): Promise<void> {
  return state().writeQueue;
}
