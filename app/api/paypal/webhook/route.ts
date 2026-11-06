import { NextResponse } from "next/server";
import {
  getInvoice,
  kitPrice,
  PayPalError,
  PayPalNotConfiguredError,
  verifyWebhookSignature,
} from "@/lib/paypal";
import {
  type CaptureRef,
  getCaptureRef,
  getInvoiceRef,
  getOrderRef,
  markPaid,
  markRevoked,
} from "@/lib/store";

interface WebhookEvent {
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    amount?: { value?: string; total?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
    links?: Array<{ rel?: string; href?: string }>;
    invoice?: { id?: string };
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(request.headers, rawBody);
  } catch (error) {
    if (error instanceof PayPalNotConfiguredError) {
      console.error("webhook: PAYPAL_WEBHOOK_ID or PayPal credentials are not set; refusing event");
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    if (error instanceof PayPalError && error.status < 500 && error.status !== 429) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }
    // PayPal retries on a 5xx, which is right when verification itself could not run.
    console.error("webhook: could not reach PayPal to verify the event");
    return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
  }
  if (!verified) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (error) {
    console.error(`webhook: ${error instanceof PayPalError ? error.message : "handler failed"}`);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  const resource = event.resource;
  if (!resource) return;

  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      const ref = orderId ? getOrderRef(orderId) : null;
      if (!ref || !resource.id) return;
      if (resource.custom_id && resource.custom_id !== ref.checkId) return;
      const amount = resource.amount;
      if (amount?.currency_code !== ref.currency || Number(amount?.value) !== Number(ref.amount)) {
        console.error("webhook: capture amount does not match the order; not granting access");
        return;
      }
      await markPaid(ref.checkId, { id: resource.id, amount: ref.amount });
      return;
    }

    case "PAYMENT.CAPTURE.REVERSED": {
      const paid = findPaymentForCaptureEvent(event);
      if (paid) await markRevoked(paid.checkId);
      return;
    }

    case "PAYMENT.CAPTURE.REFUNDED": {
      const paid = findPaymentForCaptureEvent(event);
      if (!paid) return;
      // A partial, goodwill refund leaves the customer's kit in place. "Full" is measured against
      // what this customer paid, not today's price.
      const refunded = Number(resource.amount?.value ?? resource.amount?.total);
      if (Number.isFinite(refunded) && refunded < Number(paid.amount)) return;
      await markRevoked(paid.checkId);
      return;
    }

    case "INVOICING.INVOICE.PAID": {
      const invoiceId = resource.id ?? resource.invoice?.id;
      const ref = invoiceId ? getInvoiceRef(invoiceId) : null;
      if (!invoiceId || !ref) return;
      // This event also fires for partial and pending payments, so PayPal's current state decides.
      const invoice = await getInvoice(invoiceId);
      if (invoice.status !== "PAID" || invoice.detail?.reference !== ref.checkId) return;
      if (Number(invoice.amount?.value) !== Number(ref.amount)) {
        console.error("webhook: invoice amount does not match; not granting access");
        return;
      }
      await markPaid(ref.checkId);
      return;
    }

    case "INVOICING.INVOICE.REFUNDED": {
      const invoiceId = resource.id ?? resource.invoice?.id;
      const ref = invoiceId ? getInvoiceRef(invoiceId) : null;
      if (!invoiceId || !ref) return;
      const invoice = await getInvoice(invoiceId);
      if (invoice.status === "REFUNDED") await markRevoked(ref.checkId);
      return;
    }

    default:
      return;
  }
}

/** Refund and reversal events point back at their capture through an "up" link. */
function findPaymentForCaptureEvent(event: WebhookEvent): CaptureRef | null {
  const up = event.resource?.links?.find((link) => link.rel === "up")?.href;
  const captureId = up?.match(/\/captures\/([^/?#]+)/)?.[1] ?? event.resource?.id;
  const fromCapture = captureId ? getCaptureRef(captureId) : null;
  if (fromCapture) return fromCapture;
  // Older or unusual events: the signed event names the check, and the price stands in.
  const checkId = event.resource?.custom_id;
  return checkId ? { checkId, amount: kitPrice() } : null;
}
