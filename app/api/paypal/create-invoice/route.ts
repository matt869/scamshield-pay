import { NextResponse } from "next/server";
import { bodyError, DEFAULT_MAX_BODY, readJson } from "@/lib/http";
import { z } from "zod";
import { t } from "@/lib/i18n";
import {
  createAndSendInvoice,
  KIT_CURRENCY,
  kitPrice,
  PayPalError,
  PayPalNotConfiguredError,
} from "@/lib/paypal";
import { allowCostly } from "@/lib/rate-limit";
import { extendForInvoice, getCheck, rememberInvoice } from "@/lib/store";
import { LanguageSchema } from "@/lib/types";

const MAX_INVOICES_PER_CHECK = 2;

const RequestSchema = z.object({
  checkId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  language: LanguageSchema,
});

export async function POST(request: Request) {
  // PayPal emails whatever address is given here, so this route is kept on a short leash.
  if (!(await allowCostly(request, "invoice", 5, 30))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await readJson(request, DEFAULT_MAX_BODY);
  if (!body.ok) return bodyError(body.status);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  const { checkId, email, language } = parsed.data;

  const check = await getCheck(checkId);
  if (!check) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (check.paymentStatus === "paid") return NextResponse.json({ error: "already_paid" }, { status: 409 });
  if (check.paymentStatus === "revoked") return NextResponse.json({ error: "payment_revoked" }, { status: 409 });
  if (check.invoicesSent >= MAX_INVOICES_PER_CHECK) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const copy = t(language);

  try {
    const amount = kitPrice();
    const invoice = await createAndSendInvoice({
      checkId,
      amount,
      recipientEmail: email,
      itemName: copy.pay.invoiceItem,
      note: `${copy.pay.invoiceNote} ${appUrl}/success?id=${checkId}`,
    });
    await rememberInvoice(invoice.id, { checkId, amount, currency: KIT_CURRENCY });
    await extendForInvoice(checkId);
    return NextResponse.json({ sent: true });
  } catch (error) {
    if (error instanceof PayPalNotConfiguredError) {
      return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
    }
    console.error(`create-invoice: ${error instanceof PayPalError ? error.message : "unexpected error"}`);
    return NextResponse.json({ error: "payment_failed" }, { status: 502 });
  }
}
