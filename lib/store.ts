import type { CheckRecord } from "./types";

/**
 * Where checks, payment references, and rate-limit counters live.
 *
 * - On Cloudflare Workers (STORE_BACKEND=d1): the D1 database, see store-d1.ts.
 * - Anywhere else: a JSON file behind an in-memory copy, which suits one long-running server
 *   process with a persistent disk.
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

/** PayPal capture ID to what it paid for, so refunds can find what they reverse. */
export interface CaptureRef {
  checkId: string;
  amount: string;
}

function usingD1(): boolean {
  return process.env.STORE_BACKEND === "d1";
}

async function d1() {
  return import("./store-d1");
}

// ---------- File backend ----------

interface StoreData {
  checks: Record<string, CheckRecord>;
  orders: Record<string, OrderRef>;
  invoices: Record<string, InvoiceRef>;
  captures: Record<string, CaptureRef>;
}

interface StoreState {
  file: string;
  data: StoreData;
  loaded: boolean;
  writeQueue: Promise<void>;
  /** Set only when the file on disk could not be read, so that it is never overwritten. */
  persistenceDisabled: boolean;
  writeFailing: boolean;
}

function emptyData(): StoreData {
  return { checks: {}, orders: {}, invoices: {}, captures: {} };
}

// On globalThis because Next.js can bundle this module once per route.
const globalForStore = globalThis as typeof globalThis & { __scamshieldStore?: StoreState };

async function fsModules() {
  const [fs, path] = await Promise.all([import("node:fs"), import("node:path")]);
  return { fs: fs.default, path: path.default };
}

async function state(): Promise<StoreState> {
  const { fs, path } = await fsModules();
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.STORE_FILE || ".data/store.json");
  let current = globalForStore.__scamshieldStore;
  if (!current || current.file !== file) {
    current = {
      file,
      data: emptyData(),
      loaded: false,
      writeQueue: Promise.resolve(),
      persistenceDisabled: false,
      writeFailing: false,
    };
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

async function persist(current: StoreState): Promise<void> {
  if (current.persistenceDisabled) return;
  const { fs, path } = await fsModules();
  const snapshot = JSON.stringify(current.data);
  current.writeQueue = current.writeQueue.then(async () => {
    try {
      await fs.promises.mkdir(path.dirname(current.file), { recursive: true });
      const temp = `${current.file}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, snapshot, { mode: 0o600 });
      await renameWithRetry(fs, temp, current.file);
      if (current.writeFailing) console.error("store: writing the store file works again");
      current.writeFailing = false;
    } catch (error) {
      // Each write carries the whole store, so the next successful one catches up.
      if (!current.writeFailing) {
        console.error(
          `store: cannot write the store file (${(error as NodeJS.ErrnoException).code ?? "unknown"}); ` +
            "records are kept in memory and saved on the next successful write",
        );
      }
      current.writeFailing = true;
    }
  });
  return current.writeQueue;
}

/** On Windows a rename fails briefly while another process, such as antivirus, has the file open. */
async function renameWithRetry(fs: typeof import("node:fs"), from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
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
  for (const [id, ref] of Object.entries(captures)) {
    if (!checks[ref.checkId]) delete captures[id];
  }
}

// ---------- Shared helpers for the D1 backend ----------

async function d1Read<T>(key: string): Promise<T | null> {
  const raw = await (await d1()).d1Get(key, Date.now());
  return raw ? (JSON.parse(raw) as T) : null;
}

async function d1Write(key: string, value: unknown, expiresAt: number): Promise<void> {
  await (await d1()).d1Put(key, JSON.stringify(value), expiresAt);
}

// ---------- Public API ----------

export async function saveCheck(record: CheckRecord): Promise<void> {
  if (usingD1()) {
    const store = await d1();
    // Cheap enough to do on every save, and it keeps deleted messages deleted.
    await store.d1Purge(Date.now());
    await d1Write(`check:${record.id}`, record, record.expiresAt);
    return;
  }
  const current = await state();
  purgeExpired(current, Date.now());
  current.data.checks[record.id] = record;
  await persist(current);
}

export async function getCheck(id: string, now = Date.now()): Promise<CheckRecord | null> {
  if (usingD1()) return d1Read<CheckRecord>(`check:${id}`);
  const check = (await state()).data.checks[id];
  return check && check.expiresAt > now ? check : null;
}

/** Applies a change to a check and saves it. Returns null when the check is gone. */
export async function updateCheck(
  id: string,
  change: (check: CheckRecord) => void,
): Promise<CheckRecord | null> {
  const check = await getCheck(id);
  if (!check) return null;
  change(check);
  if (usingD1()) {
    await d1Write(`check:${id}`, check, check.expiresAt);
  } else {
    await persist(await state());
  }
  return check;
}

export async function rememberOrder(orderId: string, ref: OrderRef): Promise<void> {
  if (usingD1()) return d1Write(`order:${orderId}`, ref, Date.now() + PAID_TTL_MS);
  const current = await state();
  current.data.orders[orderId] = ref;
  await persist(current);
}

export async function getOrderRef(orderId: string): Promise<OrderRef | null> {
  if (usingD1()) return d1Read<OrderRef>(`order:${orderId}`);
  return (await state()).data.orders[orderId] ?? null;
}

export async function rememberInvoice(invoiceId: string, ref: InvoiceRef): Promise<void> {
  if (usingD1()) return d1Write(`invoice:${invoiceId}`, ref, Date.now() + PAID_TTL_MS);
  const current = await state();
  current.data.invoices[invoiceId] = ref;
  await persist(current);
}

export async function getInvoiceRef(invoiceId: string): Promise<InvoiceRef | null> {
  if (usingD1()) return d1Read<InvoiceRef>(`invoice:${invoiceId}`);
  return (await state()).data.invoices[invoiceId] ?? null;
}

export async function getCaptureRef(captureId: string): Promise<CaptureRef | null> {
  if (usingD1()) return d1Read<CaptureRef>(`capture:${captureId}`);
  return (await state()).data.captures[captureId] ?? null;
}

/**
 * Grants the kit. A revoked payment stays revoked, so a retried "completed" webhook arriving
 * after a refund cannot hand the kit back.
 */
export async function markPaid(
  checkId: string,
  capture?: { id: string; amount: string },
): Promise<CheckRecord | null> {
  if (capture) {
    const ref: CaptureRef = { checkId, amount: capture.amount };
    if (usingD1()) await d1Write(`capture:${capture.id}`, ref, Date.now() + PAID_TTL_MS);
    else (await state()).data.captures[capture.id] = ref;
  }
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

/** Counts one request against a fixed window and returns the count so far. */
export async function countHit(key: string, windowMs: number, now = Date.now()): Promise<number> {
  if (usingD1()) return (await d1()).d1Hit(key, windowMs, now);
  return memoryHit(key, windowMs, now);
}

type Window = { count: number; resetAt: number };
const globalForLimits = globalThis as typeof globalThis & { __scamshieldLimits?: Map<string, Window> };

function memoryHit(key: string, windowMs: number, now: number): number {
  const windows = (globalForLimits.__scamshieldLimits ??= new Map<string, Window>());
  if (windows.size > 10_000) {
    for (const [storedKey, window] of windows) {
      if (window.resetAt <= now) windows.delete(storedKey);
    }
  }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  current.count += 1;
  return current.count;
}

/** Test helper: flushes pending writes. */
export async function storeIdle(): Promise<void> {
  if (usingD1()) return;
  return (await state()).writeQueue;
}
