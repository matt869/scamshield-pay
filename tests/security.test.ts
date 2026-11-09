import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as analyze } from "@/app/api/analyze/route";
import { readJson } from "@/lib/http";
import { allowCostly, clientAddress } from "@/lib/rate-limit";

const req = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/analyze", { method: "POST", headers, body });

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  delete process.env.DEMO_MODE;
  vi.restoreAllMocks();
});

describe("request bodies", () => {
  it("refuses a cross-site form post (not JSON)", async () => {
    const response = await analyze(req('{"message":"pay with gift cards today please","language":"en"}', { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("refuses a body that declares itself too large, without reading it", async () => {
    const result = await readJson(req("{}", { "content-type": "application/json", "content-length": "999999999" }), 1000);
    expect(result).toEqual({ ok: false, status: 413 });
  });

  it("cuts off a body that grows past the limit while streaming", async () => {
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 50; i++) controller.enqueue(new TextEncoder().encode("A".repeat(1000)));
        controller.close();
      },
    });
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // @ts-expect-error Node needs this for a streamed request body.
      duplex: "half",
    });
    expect(await readJson(request, 10_000)).toEqual({ ok: false, status: 413 });
  });

  it("refuses an 8 MB message on the check route", async () => {
    const body = JSON.stringify({ message: "x", pad: "A".repeat(8_000_000), language: "en" });
    const response = await analyze(req(body, { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }));
    expect(response.status).toBe(413);
  });
});

describe("visitor address", () => {
  const headers = (h: Record<string, string>) => new Request("http://localhost", { headers: h });

  it("trusts Cloudflare's own header over anything the visitor sends", () => {
    expect(clientAddress(headers({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.7");
  });

  it("ignores a faked first x-forwarded-for entry", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("caps the whole site even when every request comes from a new address", () => {
    const route = `test-${crypto.randomUUID()}`;
    const results = Array.from({ length: 8 }, (_, i) =>
      allowCostly(headers({ "cf-connecting-ip": `203.0.113.${i}` }), route, 10, 5),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });
});
