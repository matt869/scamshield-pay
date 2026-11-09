import { NextResponse } from "next/server";
import { bodyError, DEFAULT_MAX_BODY, readJson } from "@/lib/http";
import { z } from "zod";
import { ClaudeUnavailableError, generateDisputeKit } from "@/lib/claude";
import { allowCostly } from "@/lib/rate-limit";
import { getCheck, updateCheck } from "@/lib/store";
import { DisputeDetailsSchema, LanguageSchema } from "@/lib/types";

const MAX_GENERATIONS_PER_CHECK = 3;

const RequestSchema = z.object({
  checkId: z.string().uuid(),
  language: LanguageSchema,
  details: DisputeDetailsSchema,
});

export async function POST(request: Request) {
  if (!allowCostly(request, "dispute", 10, 100)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await readJson(request, DEFAULT_MAX_BODY);
  if (!body.ok) return bodyError(body.status);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_details" }, { status: 400 });
  }
  const { checkId, language, details } = parsed.data;

  const check = getCheck(checkId);
  if (!check) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (check.paymentStatus !== "paid") {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }
  if (check.disputeGenerations >= MAX_GENERATIONS_PER_CHECK) {
    return NextResponse.json({ error: "generation_limit" }, { status: 429 });
  }

  // Counted before the call, so simultaneous requests cannot slip past the limit.
  await updateCheck(checkId, (record) => {
    record.disputeGenerations += 1;
  });

  try {
    const kit = await generateDisputeKit(check.message, details, language);
    await updateCheck(checkId, (record) => {
      record.disputeKit = kit;
      record.disputeKitLanguage = language;
    });
    return NextResponse.json({ kit });
  } catch (error) {
    // A failed attempt should not use up one of the customer's paid generations.
    await updateCheck(checkId, (record) => {
      record.disputeGenerations = Math.max(0, record.disputeGenerations - 1);
    });
    if (error instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: "kit_unavailable" }, { status: 503 });
    }
    console.error(`dispute: unexpected ${error instanceof Error ? error.name : "error"}`);
    return NextResponse.json({ error: "kit_unavailable" }, { status: 500 });
  }
}
