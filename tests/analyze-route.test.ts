import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analyze/route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
  );

const tinyPng = "iVBORw0KGgo" + "A".repeat(200);

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  delete process.env.DEMO_MODE;
  vi.restoreAllMocks();
});

describe("analyze route, screenshots", () => {
  it("asks for pasted text in demo mode, which cannot read pictures", async () => {
    process.env.DEMO_MODE = "true";
    const response = await post({ image: { mediaType: "image/png", data: tinyPng }, language: "en" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "image_needs_ai" });
  });

  it.each([
    ["an unsupported file type", { mediaType: "image/gif", data: tinyPng }],
    ["data that is not base64", { mediaType: "image/png", data: "<script>".repeat(30) }],
    ["an oversized image", { mediaType: "image/png", data: "A".repeat(4_000_001) }],
  ])("rejects %s before calling any AI", async (_name, image) => {
    const response = await post({ image, language: "en" });
    expect(response.status).toBe(400);
  });

  it("still checks pasted text in demo mode", async () => {
    process.env.DEMO_MODE = "true";
    const response = await post({ message: "Pay with gift cards today or you will be arrested.", language: "en" });
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBeTruthy();
  });
});
