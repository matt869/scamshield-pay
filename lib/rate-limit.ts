/**
 * Fixed-window limiter kept in process memory. It protects the AI bill and quota, and stops the
 * invoice route being used to send email to strangers. Counters reset on restart and are per process.
 */
type Window = { count: number; resetAt: number };

const globalForLimits = globalThis as typeof globalThis & { __scamshieldLimits?: Map<string, Window> };
const windows = (globalForLimits.__scamshieldLimits ??= new Map<string, Window>());

export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (windows.size > 10_000) {
    for (const [storedKey, window] of windows) {
      if (window.resetAt <= now) windows.delete(storedKey);
    }
  }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

/**
 * The visitor's address. Behind Cloudflare, `cf-connecting-ip` is set by Cloudflare itself and
 * cannot be faked by the visitor, unlike `x-forwarded-for`, where the first entry is whatever the
 * visitor sent. This is only trustworthy when the app is reachable solely through the proxy, which
 * is why `npm start` listens on 127.0.0.1.
 */
export function clientAddress(request: Request): string {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded?.at(-1) || "unknown";
}

/**
 * A per-visitor limit plus a site-wide ceiling. The ceiling stops one person rotating addresses from
 * using up the whole AI quota.
 */
export function allowCostly(request: Request, route: string, perVisitor: number, siteWide: number): boolean {
  return (
    allowRequest(`${route}:${clientAddress(request)}`, perVisitor, HOUR_MS) &&
    allowRequest(`${route}:site`, siteWide, HOUR_MS)
  );
}

export const HOUR_MS = 60 * 60 * 1000;
