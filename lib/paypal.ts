/**
 * Server-side PayPal REST client. It only runs on the server, and the browser never decides a
 * price or tells us a payment succeeded: every grant is checked against PayPal's own response.
 */

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string | null,
  ) {
    super(`PayPal request failed with status ${status}${issue ? ` (${issue})` : ""}`);
    this.name = "PayPalError";
  }
}

export class PayPalNotConfiguredError extends Error {
  constructor() {
    super("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set");
    this.name = "PayPalNotConfiguredError";
  }
}

export const KIT_CURRENCY = "USD";

export function kitPrice(): string {
  const configured = process.env.KIT_PRICE_USD || "9.00";
  if (!/^\d+\.\d{2}$/.test(configured) || Number(configured) <= 0) {
    throw new Error("KIT_PRICE_USD must look like 9.00");
  }
  return configured;
}

export function paypalClientId(): string | null {
  return process.env.PAYPAL_CLIENT_ID || null;
}

export function isPayPalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function apiBase(): string {
  if (process.env.PAYPAL_API_BASE) return process.env.PAYPAL_API_BASE;
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

let cachedToken: { value: string; expiresAt: number; base: string } | null = null;

async function accessToken(): Promise<string> {
  const base = apiBase();
  if (cachedToken && cachedToken.base === base && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  if (!isPayPalConfigured()) throw new PayPalNotConfiguredError();
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!response.ok) throw new PayPalError(response.status, null);
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
    base,
  };
  return body.access_token;
}

async function call<T>(
  path: string,
  init: { method: string; body?: string; headers?: Record<string, string> },
): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: init.method,
    body: init.body,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    let issue: string | null = null;
    try {
      const parsed = JSON.parse(text) as { name?: string; details?: Array<{ issue?: string }> };
      issue = parsed.details?.[0]?.issue ?? parsed.name ?? null;
    } catch {
      // Not JSON; the status code is enough.
    }
    throw new PayPalError(response.status, issue);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface Money {
  value: string;
  currency_code: string;
}

export interface PayPalCapture {
  id: string;
  status: string;
  amount?: Money;
  custom_id?: string;
}

export interface PayPalOrder {
  id: string;
  status: string;
  purchase_units?: Array<{
    custom_id?: string;
    payments?: { captures?: PayPalCapture[] };
  }>;
}

export function createOrder(checkId: string, amount: string): Promise<PayPalOrder> {
  return call<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": crypto.randomUUID() },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: checkId,
          description: "ScamShield Pay dispute kit",
          amount: { currency_code: KIT_CURRENCY, value: amount },
        },
      ],
      application_context: {
        brand_name: "ScamShield Pay",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });
}

export function captureOrder(orderId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      // Stable per order, so a retried capture can never charge twice.
      "PayPal-Request-Id": `capture-${orderId}`,
      Prefer: "return=representation",
    },
  });
}

export function getOrder(orderId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
}

export type CaptureOutcome =
  | { state: "completed"; captureId: string }
  | { state: "pending"; captureId: string }
  | { state: "invalid"; reason: string };

/** Decides whether an order really paid for this check, at the price we asked for. */
export function evaluateOrder(
  order: PayPalOrder,
  expected: { checkId: string; amount: string; currency: string },
): CaptureOutcome {
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!capture) return { state: "invalid", reason: "no capture on the order" };
  const customId = capture.custom_id ?? unit?.custom_id;
  if (customId !== expected.checkId) return { state: "invalid", reason: "order belongs to another check" };
  if (
    !capture.amount ||
    capture.amount.currency_code !== expected.currency ||
    Number(capture.amount.value) !== Number(expected.amount)
  ) {
    return { state: "invalid", reason: "captured amount does not match" };
  }
  if (capture.status === "COMPLETED") return { state: "completed", captureId: capture.id };
  if (capture.status === "PENDING") return { state: "pending", captureId: capture.id };
  return { state: "invalid", reason: `capture status ${capture.status}` };
}

export interface PayPalInvoice {
  id: string;
  status: string;
  detail?: { reference?: string };
  amount?: { value?: string; currency_code?: string };
}

export async function createAndSendInvoice(params: {
  checkId: string;
  amount: string;
  recipientEmail: string;
  note: string;
  itemName: string;
}): Promise<PayPalInvoice> {
  const { invoice_number } = await call<{ invoice_number: string }>(
    "/v2/invoicing/generate-next-invoice-number",
    { method: "POST" },
  );
  const invoice = await call<PayPalInvoice>("/v2/invoicing/invoices", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      detail: {
        invoice_number,
        reference: params.checkId,
        currency_code: KIT_CURRENCY,
        note: params.note,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      ...(process.env.PAYPAL_INVOICER_EMAIL
        ? { invoicer: { email_address: process.env.PAYPAL_INVOICER_EMAIL } }
        : {}),
      primary_recipients: [{ billing_info: { email_address: params.recipientEmail } }],
      items: [
        {
          name: params.itemName,
          quantity: "1",
          unit_amount: { currency_code: KIT_CURRENCY, value: params.amount },
          unit_of_measure: "QUANTITY",
        },
      ],
      configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
    }),
  });
  await call(`/v2/invoicing/invoices/${encodeURIComponent(invoice.id)}/send`, {
    method: "POST",
    body: JSON.stringify({ send_to_invoicer: false, send_to_recipient: true }),
  });
  return invoice;
}

export function getInvoice(invoiceId: string): Promise<PayPalInvoice> {
  return call<PayPalInvoice>(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "GET",
  });
}

export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new PayPalNotConfiguredError();
  const field = (name: string) => headers.get(name);
  const fields = {
    auth_algo: field("paypal-auth-algo"),
    cert_url: field("paypal-cert-url"),
    transmission_id: field("paypal-transmission-id"),
    transmission_sig: field("paypal-transmission-sig"),
    transmission_time: field("paypal-transmission-time"),
    webhook_id: webhookId,
  };
  if (Object.values(fields).some((value) => !value)) return false;

  // PayPal warns that a re-serialized event can fail verification, so the raw body is spliced in.
  const prefix = JSON.stringify(fields).slice(0, -1);
  const result = await call<{ verification_status?: string }>(
    "/v1/notifications/verify-webhook-signature",
    { method: "POST", body: `${prefix},"webhook_event":${rawBody}}` },
  );
  return result.verification_status === "SUCCESS";
}
