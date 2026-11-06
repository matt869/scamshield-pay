import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as capturePost } from "@/app/api/paypal/capture-order/route";
import { POST as createOrderPost } from "@/app/api/paypal/create-order/route";
import { POST as webhookPost } from "@/app/api/paypal/webhook/route";
import { POST as disputePost } from "@/app/api/dispute/route";
import { evaluateOrder } from "@/lib/paypal";
import {
  getCheck,
  getOrderRef,
  markPaid,
  markRevoked,
  rememberInvoice,
  rememberOrder,
  saveCheck,
  storeIdle,
} from "@/lib/store";
import type { CheckRecord } from "@/lib/types";

const CHECK_ID = "11111111-1111-4111-8111-111111111111";
const EXPECTED = { checkId: CHECK_ID, amount: "9.00", currency: "USD" };

function check(overrides: Partial<CheckRecord> = {}): CheckRecord {
  return {
    id: CHECK_ID,
    message: "Pay with gift cards now",
    language: "en",
    analysis: {
      risk: "high",
      scam_type: "other",
      headline: "h",
      summary: "s",
      red_flags: [],
      next_steps: ["n"],
    },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    paymentStatus: "none",
    paidAt: null,
    invoicesSent: 0,
    disputeKit: null,
    disputeKitLanguage: null,
    disputeGenerations: 0,
    ...overrides,
  };
}

function capturedOrder(overrides: { status?: string; value?: string; currency?: string; customId?: string } = {}) {
  return {
    id: "ORDER1",
    status: "COMPLETED",
    purchase_units: [
      {
        payments: {
          captures: [
            {
              id: "CAP1",
              status: overrides.status ?? "COMPLETED",
              custom_id: overrides.customId ?? CHECK_ID,
              amount: { value: overrides.value ?? "9.00", currency_code: overrides.currency ?? "USD" },
            },
          ],
        },
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Stands in for PayPal: answers the token call, then routes everything else to `handler`. */
function mockPayPal(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return jsonResponse({ access_token: "token", expires_in: 3600 });
    }
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": crypto.randomUUID(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SIGNED = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.paypal.com/cert",
  "paypal-transmission-id": "tid",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-11-05T00:00:00Z",
};

let storeDir: string;

beforeEach(() => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "scamshield-test-"));
  process.env.STORE_FILE = path.join(storeDir, "store.json");
  process.env.PAYPAL_CLIENT_ID = "id";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  process.env.PAYPAL_WEBHOOK_ID = "WH-1";
  process.env.KIT_PRICE_USD = "9.00";
  delete process.env.PAYPAL_ENV;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await storeIdle();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("evaluateOrder", () => {
  it("accepts a completed capture for the right check and amount", () => {
    expect(evaluateOrder(capturedOrder(), EXPECTED)).toEqual({ state: "completed", captureId: "CAP1" });
  });

  it("reports a pending capture as pending", () => {
    expect(evaluateOrder(capturedOrder({ status: "PENDING" }), EXPECTED).state).toBe("pending");
  });

  it.each([
    ["a smaller amount", { value: "0.01" }],
    ["another currency", { currency: "EUR" }],
    ["another check", { customId: "other" }],
    ["a declined capture", { status: "DECLINED" }],
  ])("rejects %s", (_name, overrides) => {
    expect(evaluateOrder(capturedOrder(overrides), EXPECTED).state).toBe("invalid");
  });

  it("rejects an order with no capture", () => {
    expect(evaluateOrder({ id: "x", status: "APPROVED" }, EXPECTED).state).toBe("invalid");
  });
});

describe("create-order", () => {
  it("uses the server's price and records the order", async () => {
    await saveCheck(check());
    const fetchMock = mockPayPal(() => jsonResponse({ id: "ORDER1", status: "CREATED" }, 201));

    const response = await createOrderPost(post("/api/paypal/create-order", { checkId: CHECK_ID, amount: "0.01" }));

    expect(await response.json()).toEqual({ orderId: "ORDER1" });
    const sent = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(sent.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "9.00" });
    expect(sent.purchase_units[0].custom_id).toBe(CHECK_ID);
    expect(getOrderRef("ORDER1")).toEqual(EXPECTED);
  });
});

describe("capture-order", () => {
  it("unlocks the check only after PayPal confirms the capture", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    const fetchMock = mockPayPal(() => jsonResponse(capturedOrder()));

    const response = await capturePost(post("/api/paypal/capture-order", { orderId: "ORDER1" }));

    expect(await response.json()).toEqual({ status: "completed", checkId: CHECK_ID });
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("paid");
    const headers = fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string>;
    expect(headers["PayPal-Request-Id"]).toBe("capture-ORDER1");
  });

  it("refuses an order we did not create, without calling PayPal", async () => {
    await saveCheck(check());
    const fetchMock = mockPayPal(() => jsonResponse(capturedOrder()));

    const response = await capturePost(post("/api/paypal/capture-order", { orderId: "SOMEONE-ELSES" }));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("none");
  });

  it("does not unlock when the captured amount is wrong", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    mockPayPal(() => jsonResponse(capturedOrder({ value: "0.01" })));

    const response = await capturePost(post("/api/paypal/capture-order", { orderId: "ORDER1" }));

    expect(response.status).toBe(402);
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("none");
  });

  it("does not unlock while the capture is pending", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    mockPayPal(() => jsonResponse(capturedOrder({ status: "PENDING" })));

    const response = await capturePost(post("/api/paypal/capture-order", { orderId: "ORDER1" }));

    expect(await response.json()).toMatchObject({ status: "pending" });
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("none");
  });

  it("tells the browser to restart checkout on a declined instrument", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    mockPayPal(() => jsonResponse({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }, 422));

    const response = await capturePost(post("/api/paypal/capture-order", { orderId: "ORDER1" }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "instrument_declined" });
  });

  it("recovers when PayPal says the order was already captured", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    mockPayPal((url, init) =>
      init?.method === "POST"
        ? jsonResponse({ details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }, 422)
        : jsonResponse(capturedOrder()),
    );

    const response = await capturePost(post("/api/paypal/capture-order", { orderId: "ORDER1" }));

    expect(response.status).toBe(200);
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("paid");
  });

  it("takes no more money for a refunded check", async () => {
    await saveCheck(check({ paymentStatus: "revoked" }));
    await rememberOrder("ORDER1", EXPECTED);
    const fetchMock = mockPayPal(() => jsonResponse(capturedOrder()));

    const response = await capturePost(post("/api/paypal/capture-order", { orderId: "ORDER1" }));

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("webhook", () => {
  const completed = JSON.stringify({
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP1",
      status: "COMPLETED",
      custom_id: CHECK_ID,
      amount: { value: "9.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "ORDER1" } },
    },
  });

  function verifying(status: "SUCCESS" | "FAILURE", other?: (url: string) => Response) {
    return mockPayPal((url) =>
      url.endsWith("/v1/notifications/verify-webhook-signature")
        ? jsonResponse({ verification_status: status })
        : (other?.(url) ?? jsonResponse({})),
    );
  }

  it("ignores an event whose signature fails", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    verifying("FAILURE");

    const response = await webhookPost(post("/api/paypal/webhook", completed, SIGNED));

    expect(response.status).toBe(400);
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("none");
  });

  it("refuses unsigned events without calling PayPal", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    const fetchMock = verifying("SUCCESS");

    const response = await webhookPost(post("/api/paypal/webhook", completed));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("none");
  });

  it("refuses every event when no webhook ID is configured", async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    verifying("SUCCESS");

    const response = await webhookPost(post("/api/paypal/webhook", completed, SIGNED));

    expect(response.status).toBe(503);
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("none");
  });

  it("sends the raw event body back for verification, unchanged", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    const fetchMock = verifying("SUCCESS");
    const spaced = completed.replace('"event_type":', '"event_type" :  ');

    await webhookPost(post("/api/paypal/webhook", spaced, SIGNED));

    const sent = String(fetchMock.mock.calls.at(-1)?.[1]?.body);
    expect(sent).toContain(`"webhook_event":${spaced}}`);
    expect(JSON.parse(sent).webhook_id).toBe("WH-1");
  });

  it("grants on a verified completed capture", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    verifying("SUCCESS");

    const response = await webhookPost(post("/api/paypal/webhook", completed, SIGNED));

    expect(response.status).toBe(200);
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("paid");
  });

  it("stays revoked if a completed event is replayed after a refund", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    verifying("SUCCESS");
    await webhookPost(post("/api/paypal/webhook", completed, SIGNED));

    const refund = JSON.stringify({
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REFUND1",
        amount: { value: "9.00", currency_code: "USD" },
        links: [{ rel: "up", href: "https://api.paypal.com/v2/payments/captures/CAP1" }],
      },
    });
    await webhookPost(post("/api/paypal/webhook", refund, SIGNED));
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("revoked");

    await webhookPost(post("/api/paypal/webhook", completed, SIGNED));
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("revoked");
  });

  it("keeps access after a partial refund", async () => {
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    verifying("SUCCESS");
    await webhookPost(post("/api/paypal/webhook", completed, SIGNED));

    const refund = JSON.stringify({
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REFUND1",
        amount: { value: "2.00", currency_code: "USD" },
        links: [{ rel: "up", href: "https://api.paypal.com/v2/payments/captures/CAP1" }],
      },
    });
    await webhookPost(post("/api/paypal/webhook", refund, SIGNED));

    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("paid");
  });

  it.each([
    ["paid in full", { status: "PAID", value: "9.00" }, "paid"],
    ["only partly paid", { status: "PARTIALLY_PAID", value: "9.00" }, "none"],
    ["payment pending", { status: "PAYMENT_PENDING", value: "9.00" }, "none"],
    ["the wrong amount", { status: "PAID", value: "1.00" }, "none"],
  ])("for an invoice with %s, follows PayPal's current state", async (_name, invoice, expected) => {
    await saveCheck(check());
    await rememberInvoice("INV1", EXPECTED);
    verifying("SUCCESS", () =>
      jsonResponse({
        id: "INV1",
        status: invoice.status,
        detail: { reference: CHECK_ID },
        amount: { value: invoice.value, currency_code: "USD" },
      }),
    );

    const event = JSON.stringify({ event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV1", status: "PAID" } });
    const response = await webhookPost(post("/api/paypal/webhook", event, SIGNED));

    expect(response.status).toBe(200);
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe(expected);
  });
});

describe("dispute", () => {
  const details = {
    paymentMethod: "gift_card",
    institution: "",
    amount: "$500",
    paymentDate: "",
    recipient: "",
    whatHappened: "Someone told me my grandson was in jail.",
  };

  it("does not write anything until the kit is paid for", async () => {
    await saveCheck(check());
    const response = await disputePost(post("/api/dispute", { checkId: CHECK_ID, language: "en", details }));
    expect(response.status).toBe(402);
    expect(getCheck(CHECK_ID)?.disputeGenerations).toBe(0);
  });

  it("closes the kit after a refund", async () => {
    await saveCheck(check({ paymentStatus: "revoked" }));
    const response = await disputePost(post("/api/dispute", { checkId: CHECK_ID, language: "en", details }));
    expect(response.status).toBe(402);
  });

  it("stops at the generation limit", async () => {
    await saveCheck(check({ paymentStatus: "paid", disputeGenerations: 3 }));
    const response = await disputePost(post("/api/dispute", { checkId: CHECK_ID, language: "en", details }));
    expect(response.status).toBe(429);
  });
});

describe("refunds after a price change", () => {
  it("measures a full refund against what the customer paid", async () => {
    process.env.KIT_PRICE_USD = "15.00";
    await saveCheck(check());
    await rememberOrder("ORDER1", EXPECTED);
    mockPayPal((url) =>
      url.endsWith("/v1/notifications/verify-webhook-signature")
        ? jsonResponse({ verification_status: "SUCCESS" })
        : jsonResponse(capturedOrder()),
    );
    await capturePost(post("/api/paypal/capture-order", { orderId: "ORDER1" }));
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("paid");

    const refund = JSON.stringify({
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REFUND1",
        amount: { value: "9.00", currency_code: "USD" },
        links: [{ rel: "up", href: "https://api.paypal.com/v2/payments/captures/CAP1" }],
      },
    });
    await webhookPost(post("/api/paypal/webhook", refund, SIGNED));

    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("revoked");
  });
});

describe("store", () => {
  it("keeps saving after a write fails once", async () => {
    await saveCheck(check());
    await storeIdle();
    const file = process.env.STORE_FILE as string;
    // A directory where the file should be makes the next write fail.
    fs.rmSync(file);
    fs.mkdirSync(file);
    await markPaid(CHECK_ID);
    expect(getCheck(CHECK_ID)?.paymentStatus).toBe("paid");

    fs.rmSync(file, { recursive: true });
    await markRevoked(CHECK_ID);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.checks[CHECK_ID].paymentStatus).toBe("revoked");
  });

  it("never overwrites a store file it could not read", async () => {
    const file = process.env.STORE_FILE as string;
    fs.writeFileSync(file, "{ not json");
    await saveCheck(check());
    await storeIdle();
    expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
  });

  it("hides and purges expired checks", async () => {
    await saveCheck(check({ expiresAt: Date.now() - 1 }));
    expect(getCheck(CHECK_ID)).toBeNull();

    const other = "22222222-2222-4222-8222-222222222222";
    await saveCheck(check({ id: other }));
    await storeIdle();
    const saved = JSON.parse(fs.readFileSync(process.env.STORE_FILE as string, "utf8"));
    expect(Object.keys(saved.checks)).toEqual([other]);
  });
});
