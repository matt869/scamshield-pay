import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError, geminiStructured } from "@/lib/gemini";
import { AnalysisSchema } from "@/lib/types";

const VALID = {
  risk: "high",
  scam_type: "family_emergency",
  headline: "This looks like a scam.",
  summary: "Someone wants gift cards.",
  red_flags: [{ title: "Gift cards", explanation: "Not how bail works.", quote: "gift cards" }],
  next_steps: ["Call your grandchild on the number you know."],
};

function reply(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

function candidate(text: string, finishReason = "STOP") {
  return { candidates: [{ finishReason, content: { parts: [{ text: "thinking…", thought: true }, { text }] } }] };
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gemini", () => {
  it("returns the parsed report and ignores thought parts", async () => {
    reply(candidate(JSON.stringify(VALID)));
    await expect(geminiStructured(AnalysisSchema, "sys", "prompt")).resolves.toMatchObject({ risk: "high" });
  });

  it("sends the real schema with enums and the key in a header", async () => {
    reply(candidate(JSON.stringify(VALID)));
    await geminiStructured(AnalysisSchema, "sys", "prompt");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseJsonSchema.properties.risk.enum).toEqual(["high", "medium", "low"]);
  });

  it.each([
    ["a verdict outside the schema", candidate(JSON.stringify({ ...VALID, risk: "probably fine" })), 200, "incomplete"],
    ["cut-off output", candidate("{\"risk\":", "MAX_TOKENS"), 200, "incomplete"],
    ["a safety block", { promptFeedback: { blockReason: "SAFETY" } }, 200, "declined"],
    ["a blocked answer", candidate("", "SAFETY"), 200, "declined"],
    ["rate limiting", { error: { status: "RESOURCE_EXHAUSTED" } }, 429, "busy"],
    ["a bad key", { error: { status: "PERMISSION_DENIED" } }, 403, "not_configured"],
  ])("gives no verdict for %s", async (_name, body, status, reason) => {
    reply(body, status);
    await expect(geminiStructured(AnalysisSchema, "sys", "prompt")).rejects.toMatchObject({ reason });
  });

  it("falls back to the lighter model when the main one is rate limited", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(candidate(JSON.stringify(VALID))), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiStructured(AnalysisSchema, "sys", "prompt")).resolves.toMatchObject({ risk: "high" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("gemini-3.5-flash:");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("gemini-3.5-flash-lite:");
  });

  it("moves to the backup key when the main key is used up on every model", async () => {
    process.env.GEMINI_BACKUP_API_KEY = "backup-key";
    const busy = () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(new Response(JSON.stringify(candidate(JSON.stringify(VALID))), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiStructured(AnalysisSchema, "sys", "prompt")).resolves.toMatchObject({ risk: "high" });
    const keysUsed = fetchMock.mock.calls.map((call) => (call[1] as RequestInit & { headers: Record<string, string> }).headers["x-goog-api-key"]);
    expect(keysUsed).toEqual(["test-key", "test-key", "backup-key"]);
    delete process.env.GEMINI_BACKUP_API_KEY;
  });

  it("moves to the backup key straight away when the main key is rejected", async () => {
    process.env.GEMINI_BACKUP_API_KEY = "backup-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(candidate(JSON.stringify(VALID))), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiStructured(AnalysisSchema, "sys", "prompt")).resolves.toMatchObject({ risk: "high" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    delete process.env.GEMINI_BACKUP_API_KEY;
  });

  it("does not fall back on a safety block", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiStructured(AnalysisSchema, "sys", "prompt")).rejects.toMatchObject({ reason: "declined" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to run without a key", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(geminiStructured(AnalysisSchema, "sys", "prompt")).rejects.toBeInstanceOf(GeminiError);
  });
});
