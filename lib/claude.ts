import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import resources from "@/data/resources.json";
import { demoAnalysis, demoDisputeKit, isDemoMode } from "./demo";
import { GeminiError, geminiStructured } from "./gemini";
import { applyGuardrails } from "./guardrails";
import { buildDisputePrompt, DISPUTE_SYSTEM } from "./prompts/dispute-letter";
import { buildClassifierPrompt, buildImagePrompt, SCAM_CLASSIFIER_SYSTEM } from "./prompts/scam-classifier";
import {
  type Analysis,
  AnalysisSchema,
  type DisputeDetails,
  type DisputeKit,
  DisputeKitSchema,
  type ImageInput,
  ImageAnalysisSchema,
  type Language,
  MESSAGE_MAX_CHARS,
  MESSAGE_MIN_CHARS,
} from "./types";

export class ClaudeUnavailableError extends Error {
  constructor(
    readonly reason: "not_configured" | "busy" | "failed" | "declined" | "incomplete",
    options?: ErrorOptions,
  ) {
    super(`Claude request failed: ${reason}`, options);
    this.name = "ClaudeUnavailableError";
  }
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  // An empty ANTHROPIC_API_KEY= line would override an `ant auth login` profile.
  if (process.env.ANTHROPIC_API_KEY === "") delete process.env.ANTHROPIC_API_KEY;
  return (client ??= new Anthropic());
}

function model(): string {
  return process.env.CLAUDE_MODEL || "claude-opus-5-5";
}

/**
 * The SDK helper downgrades enums to a hint in a description, leaving them enforced only after the
 * response arrives. A verdict is too important for that, so this sends the real schema, and keeps
 * the helper's Zod parse as a second check. A response that fails the parse gives no verdict.
 */
export function strictOutputFormat<Schema extends z.ZodType>(schema: Schema) {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { ...betaZodOutputFormat(schema), schema: jsonSchema };
}

async function requestStructured<Schema extends z.ZodType>(
  schema: Schema,
  system: string,
  prompt: string,
  image?: ImageInput,
): Promise<z.infer<Schema>> {
  if (process.env.AI_PROVIDER === "gemini") {
    try {
      return await geminiStructured(schema, system, prompt, image);
    } catch (error) {
      if (error instanceof GeminiError) throw new ClaudeUnavailableError(error.reason, { cause: error });
      throw new ClaudeUnavailableError("failed", { cause: error });
    }
  }

  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: model(),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [
        {
          role: "user",
          content: [
            ...(image
              ? [{ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } }]
              : []),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
      output_config: { effort: "medium", format: strictOutputFormat(schema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new ClaudeUnavailableError("not_configured", { cause: error });
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new ClaudeUnavailableError("busy", { cause: error });
    }
    if (error instanceof Anthropic.APIError) {
      // Status only: request and response bodies hold the user's message.
      console.error(`claude: API error ${error.status ?? "connection"}`);
      throw new ClaudeUnavailableError(error.status === 529 ? "busy" : "failed", { cause: error });
    }
    if (error instanceof Error && /authentication|api.?key|credentials/i.test(error.message)) {
      throw new ClaudeUnavailableError("not_configured", { cause: error });
    }
    console.error(`claude: request failed (${error instanceof Error ? error.name : "unknown"})`);
    throw new ClaudeUnavailableError("failed", { cause: error });
  }

  if (response.stop_reason === "refusal") throw new ClaudeUnavailableError("declined");
  if (response.stop_reason !== "end_turn" || response.parsed_output === null) {
    throw new ClaudeUnavailableError("incomplete");
  }
  return response.parsed_output as z.infer<Schema>;
}

export async function analyzeMessage(message: string, language: Language): Promise<Analysis> {
  if (isDemoMode()) return applyGuardrails(demoAnalysis(message, language), message, language);
  const analysis = await requestStructured(
    AnalysisSchema,
    SCAM_CLASSIFIER_SYSTEM,
    buildClassifierPrompt(message, language),
  );
  return applyGuardrails(analysis, message, language);
}

/**
 * Checks a screenshot. The model reads the message in the image, then judges it like pasted text,
 * and the same guardrails run on what it read.
 */
export async function analyzeImage(
  image: ImageInput,
  language: Language,
): Promise<{ message: string; analysis: Analysis } | null> {
  if (isDemoMode()) throw new ClaudeUnavailableError("not_configured");
  const { message_text, ...analysis } = await requestStructured(
    ImageAnalysisSchema,
    SCAM_CLASSIFIER_SYSTEM,
    buildImagePrompt(language),
    image,
  );
  const message = message_text.trim().slice(0, MESSAGE_MAX_CHARS);
  if (message.length < MESSAGE_MIN_CHARS) return null;
  return { message, analysis: applyGuardrails(analysis, message, language) };
}

export async function generateDisputeKit(
  message: string,
  details: DisputeDetails,
  language: Language,
): Promise<DisputeKit> {
  if (isDemoMode()) return demoDisputeKit(details, language);
  const guidance = resources.paymentGuidance.find((entry) =>
    entry.methods.includes(details.paymentMethod),
  );
  return requestStructured(
    DisputeKitSchema,
    DISPUTE_SYSTEM,
    buildDisputePrompt(message, details, guidance?.en.action ?? "", language),
  );
}
