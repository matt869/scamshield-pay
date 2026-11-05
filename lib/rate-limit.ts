/**
 * Fixed-window limiter kept in process memory. It protects the Claude bill and stops the invoice
 * route being used to send email to strangers. Counters reset on restart and are per process.
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

/** Client address as reported by the hosting proxy. Only trustworthy behind one. */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export const HOUR_MS = 60 * 60 * 1000;
