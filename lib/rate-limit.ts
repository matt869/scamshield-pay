import { countHit } from "./store";

/**
 * Fixed-window limits. They protect the AI quota and stop the invoice route being used to send
 * email to strangers. On Cloudflare the counters live in D1 and are shared by every server; on a
 * single machine they are kept in memory and reset on restart.
 */
export async function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  return (await countHit(key, windowMs, now)) <= limit;
}

/**
 * The visitor's address. Behind Cloudflare, `cf-connecting-ip` is set by Cloudflare itself and
 * cannot be faked by the visitor, unlike `x-forwarded-for`, where the first entry is whatever the
 * visitor sent. This is only trustworthy when the app is reachable solely through Cloudflare, which
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
export async function allowCostly(request: Request, route: string, perVisitor: number, siteWide: number): Promise<boolean> {
  return (
    (await allowRequest(`${route}:${clientAddress(request)}`, perVisitor, HOUR_MS)) &&
    (await allowRequest(`${route}:site`, siteWide, HOUR_MS))
  );
}

export const HOUR_MS = 60 * 60 * 1000;
