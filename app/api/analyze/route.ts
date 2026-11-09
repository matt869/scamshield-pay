import { NextResponse } from "next/server";
import { bodyError, IMAGE_MAX_BODY, readJson } from "@/lib/http";
import { z } from "zod";
import { analyzeImage, analyzeMessage, ClaudeUnavailableError } from "@/lib/claude";
import { isDemoMode } from "@/lib/demo";
import { allowCostly } from "@/lib/rate-limit";
import { saveCheck, UNPAID_TTL_MS } from "@/lib/store";
import {
  type Analysis,
  ImageInputSchema,
  type Language,
  LanguageSchema,
  MESSAGE_MAX_CHARS,
  MESSAGE_MIN_CHARS,
} from "@/lib/types";

const RequestSchema = z.union([
  z.object({
    message: z.string().trim().min(MESSAGE_MIN_CHARS).max(MESSAGE_MAX_CHARS),
    language: LanguageSchema,
  }),
  z.object({ image: ImageInputSchema, language: LanguageSchema }),
]);

export async function POST(request: Request) {
  if (!(await allowCostly(request, "analyze", 10, Number(process.env.SITE_CHECKS_PER_HOUR || 300)))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await readJson(request, IMAGE_MAX_BODY);
  if (!body.ok) return bodyError(body.status);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  }
  const { language } = parsed.data;

  try {
    let message: string;
    let analysis: Analysis;
    if ("image" in parsed.data) {
      // Pattern rules cannot read pictures, so demo mode asks for pasted text instead.
      if (isDemoMode()) return NextResponse.json({ error: "image_needs_ai" }, { status: 400 });
      const result = await analyzeImage(parsed.data.image, language);
      if (!result) return NextResponse.json({ error: "no_text_in_image" }, { status: 422 });
      ({ message, analysis } = result);
    } else {
      message = parsed.data.message;
      analysis = await analyzeMessage(message, language);
    }
    const id = await save(message, language, analysis);
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

async function save(message: string, language: Language, analysis: Analysis): Promise<string> {
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
  return id;
}
