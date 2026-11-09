import { z } from "zod";
import type { ImageInput } from "./types";

/**
 * Google Gemini over its REST API, as a free-tier alternative to Claude. Selected with
 * AI_PROVIDER=gemini. Returns the parsed object, or throws GeminiError with a reason the caller
 * maps to "no verdict". It never guesses an answer.
 */
export class GeminiError extends Error {
  constructor(readonly reason: "not_configured" | "busy" | "failed" | "declined" | "incomplete") {
    super(`Gemini request failed: ${reason}`);
    this.name = "GeminiError";
  }
}

const TIMEOUT_MS = 90_000;

function model(): string {
  return process.env.GEMINI_MODEL || "gemini-3.5-flash";
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; status?: string };
}

export async function geminiStructured<Schema extends z.ZodType>(
  schema: Schema,
  system: string,
  prompt: string,
  image?: ImageInput,
): Promise<z.infer<Schema>> {
  // A backup key has its own quota, so it takes over when the main key is used up or rejected.
  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_BACKUP_API_KEY].filter(
    (value, i, all): value is string => !!value && all.indexOf(value) === i,
  );
  if (keys.length === 0) throw new GeminiError("not_configured");
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;

  // Free-tier quotas are per model, so a busy main model falls back to a lighter one.
  const models = [model(), fallbackModel()].filter((name, i, all): name is string => !!name && all.indexOf(name) === i);
  let lastError: GeminiError = new GeminiError("failed");
  for (const key of keys) {
    for (const name of models) {
      try {
        return await callModel(name, key, jsonSchema, schema, system, prompt, image);
      } catch (error) {
        if (!(error instanceof GeminiError)) throw error;
        lastError = error;
        // A rejected key cannot work with any model, so move to the next key.
        if (error.reason === "not_configured") break;
        if (error.reason !== "busy") throw error;
      }
    }
  }
  throw lastError;
}

function fallbackModel(): string | null {
  const configured = process.env.GEMINI_FALLBACK_MODEL;
  if (configured === "none") return null;
  return configured || "gemini-3.5-flash-lite";
}

async function callModel<Schema extends z.ZodType>(
  name: string,
  key: string,
  jsonSchema: Record<string, unknown>,
  schema: Schema,
  system: string,
  prompt: string,
  image?: ImageInput,
): Promise<z.infer<Schema>> {
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: "user",
              parts: [...(image ? [{ inlineData: { mimeType: image.mediaType, data: image.data } }] : []), { text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            maxOutputTokens: 16000,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
  } catch (error) {
    console.error(`gemini: request failed (${error instanceof Error ? error.name : "unknown"})`);
    throw new GeminiError(error instanceof Error && error.name === "TimeoutError" ? "busy" : "failed");
  }

  const body = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    // Status only: bodies can echo the user's message.
    console.error(`gemini: API error ${response.status} ${body.error?.status ?? ""}`);
    if (response.status === 429 || response.status === 503) throw new GeminiError("busy");
    if (response.status === 401 || response.status === 403) throw new GeminiError("not_configured");
    if (response.status === 400 && body.error?.status === "INVALID_ARGUMENT" && /key/i.test(JSON.stringify(body.error))) {
      throw new GeminiError("not_configured");
    }
    throw new GeminiError("failed");
  }

  if (body.promptFeedback?.blockReason) throw new GeminiError("declined");
  const candidate = body.candidates?.[0];
  if (!candidate) throw new GeminiError("incomplete");
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new GeminiError(candidate.finishReason === "MAX_TOKENS" ? "incomplete" : "declined");
  }

  const text = (candidate.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError("incomplete");
  }
  // The schema is enforced by Google, then checked again here: a verdict outside it gives no verdict.
  const result = schema.safeParse(parsed);
  if (!result.success) throw new GeminiError("incomplete");
  return result.data as z.infer<Schema>;
}
