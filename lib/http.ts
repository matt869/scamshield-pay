/**
 * Request body reading with two defences: a size cap enforced while streaming (so a huge upload is
 * cut off instead of filling memory), and a JSON content type (a cross-site form or image cannot
 * send that without the browser asking permission first, which this app never grants).
 */
export const DEFAULT_MAX_BODY = 64 * 1024;
/** Room for a shrunk screenshot plus the JSON around it. */
export const IMAGE_MAX_BODY = 4_500_000;

export type BodyResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 413 | 415 };

export async function readText(request: Request, maxBytes: number): Promise<BodyResult<string>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: true, value: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  return { ok: true, value: new TextDecoder().decode(Buffer.concat(chunks)) };
}

export async function readJson(request: Request, maxBytes = DEFAULT_MAX_BODY): Promise<BodyResult<unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) return { ok: false, status: 415 };
  const text = await readText(request, maxBytes);
  if (!text.ok) return text;
  try {
    return { ok: true, value: JSON.parse(text.value) };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function bodyError(status: 400 | 413 | 415): Response {
  const error = status === 413 ? "too_large" : status === 415 ? "json_required" : "invalid_request";
  return Response.json({ error }, { status });
}
