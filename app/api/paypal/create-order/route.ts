import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrder, KIT_CURRENCY, kitPrice, PayPalError, PayPalNotConfiguredError } from "@/lib/paypal";
import { allowRequest, clientAddress, HOUR_MS } from "@/lib/rate-limit";
import { getCheck, rememberOrder } from "@/lib/store";

const RequestSchema = z.object({ checkId: z.string().uuid() });

export async function POST(request: Request) {
  if (!allowRequest(`order:${clientAddress(request)}`, 20, HOUR_MS)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const check = getCheck(parsed.data.checkId);
  if (!check) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (check.paymentStatus === "paid") return NextResponse.json({ error: "already_paid" }, { status: 409 });
  if (check.paymentStatus === "revoked") return NextResponse.json({ error: "payment_revoked" }, { status: 409 });

  try {
    const amount = kitPrice();
    const order = await createOrder(check.id, amount);
    await rememberOrder(order.id, { checkId: check.id, amount, currency: KIT_CURRENCY });
    return NextResponse.json({ orderId: order.id });
  } catch (error) {
    if (error instanceof PayPalNotConfiguredError) {
      return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
    }
    console.error(`create-order: ${error instanceof PayPalError ? error.message : "unexpected error"}`);
    return NextResponse.json({ error: "payment_failed" }, { status: 502 });
  }
}
