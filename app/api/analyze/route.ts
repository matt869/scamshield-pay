import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeMessage, ClaudeUnavailableError } from "@/lib/claude";
import { allowRequest, clientAddress, HOUR_MS } from "@/lib/rate-limit";
import { saveCheck, UNPAID_TTL_MS } from "@/lib/store";
import { LanguageSchema, MESSAGE_MAX_CHARS, MESSAGE_MIN_CHARS } from "@/lib/types";

const RequestSchema = z.object({
  message: z.string().trim().min(MESSAGE_MIN_CHARS).max(MESSAGE_MAX_CHARS),
  language: LanguageSchema,
});

export async function POST(request: Request) {
  if (!allowRequest(`analyze:${clientAddress(request)}`, 10, HOUR_MS)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  }
  const { message, language } = parsed.data;

  try {
    const analysis = await analyzeMessage(message, language);
    const now = Date.now();
    const id = crypto.randomUUID();
    await saveCheck({
      id,
      message,
      language,
      analysis,
      createdAt: now,
      expiresAt: now + UNPAID_TTL_MS,
      paymentStatus: "none",
      paidAt: null,
      invoicesSent: 0,
      disputeKit: null,
      disputeKitLanguage: null,
      disputeGenerations: 0,
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof ClaudeUnavailableError) {
      // Never fall back to a verdict we did not produce; the page tells the reader to be careful.
      const status = error.reason === "busy" ? 429 : 503;
      return NextResponse.json({ error: "check_unavailable" }, { status });
    }
    console.error(`analyze: unexpected ${error instanceof Error ? error.name : "error"}`);
    return NextResponse.json({ error: "check_unavailable" }, { status: 500 });
  }
}
