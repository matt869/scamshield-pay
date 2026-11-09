import { NextResponse } from "next/server";
import { bodyError, DEFAULT_MAX_BODY, readJson } from "@/lib/http";
import { z } from "zod";
import {
  captureOrder,
  evaluateOrder,
  getOrder,
  PayPalError,
  PayPalNotConfiguredError,
  type PayPalOrder,
} from "@/lib/paypal";
import { allowRequest, clientAddress, HOUR_MS } from "@/lib/rate-limit";
import { getCheck, getOrderRef, markPaid } from "@/lib/store";

const RequestSchema = z.object({ orderId: z.string().min(1).max(64) });

export async function POST(request: Request) {
  if (!(await allowRequest(`capture:${clientAddress(request)}`, 30, HOUR_MS))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await readJson(request, DEFAULT_MAX_BODY);
  if (!body.ok) return bodyError(body.status);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { orderId } = parsed.data;

  // Only orders we created can unlock anything, and the check comes from our record of the order.
  const ref = await getOrderRef(orderId);
  if (!ref) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const check = await getCheck(ref.checkId);
  if (!check) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (check.paymentStatus === "paid") {
    return NextResponse.json({ status: "completed", checkId: check.id });
  }
  // A refunded check can never be unlocked again, so taking more money for it would be wrong.
  if (check.paymentStatus === "revoked") {
    return NextResponse.json({ error: "payment_revoked" }, { status: 409 });
  }

  let order: PayPalOrder;
  try {
    order = await captureOrder(orderId);
  } catch (error) {
    if (error instanceof PayPalError && error.issue === "INSTRUMENT_DECLINED") {
      return NextResponse.json({ error: "instrument_declined" }, { status: 422 });
    }
    if (error instanceof PayPalError && error.issue === "ORDER_ALREADY_CAPTURED") {
      order = await getOrder(orderId).catch(() => ({ id: orderId, status: "UNKNOWN" }));
    } else if (error instanceof PayPalNotConfiguredError) {
      return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
    } else {
      console.error(`capture-order: ${error instanceof PayPalError ? error.message : "unexpected error"}`);
      return NextResponse.json({ error: "payment_failed" }, { status: 502 });
    }
  }

  const outcome = evaluateOrder(order, ref);
  switch (outcome.state) {
    case "completed":
      await markPaid(check.id, { id: outcome.captureId, amount: ref.amount });
      return NextResponse.json({ status: "completed", checkId: check.id });
    case "pending":
      // The PAYMENT.CAPTURE.COMPLETED webhook grants access once the money clears.
      return NextResponse.json({ status: "pending", checkId: check.id });
    case "invalid":
      console.error(`capture-order: rejected order: ${outcome.reason}`);
      return NextResponse.json({ error: "payment_failed" }, { status: 402 });
  }
}
