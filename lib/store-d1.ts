import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Cloudflare D1 storage, used when the app runs on Cloudflare Workers (STORE_BACKEND=d1).
 * Workers have no disk, so records and rate-limit counters live in two small tables.
 * D1 is strongly consistent, so a result is readable the moment it is saved.
 */
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1Statement;
}

function db(): D1Database {
  const env = getCloudflareContext().env as unknown as { DB?: D1Database };
  if (!env.DB) throw new Error("D1 binding DB is missing");
  return env.DB;
}

export async function d1Get(key: string, now: number): Promise<string | null> {
  const row = await db()
    .prepare("SELECT value FROM records WHERE key = ?1 AND expires_at > ?2")
    .bind(key, now)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function d1Put(key: string, value: string, expiresAt: number): Promise<void> {
  await db()
    .prepare(
      "INSERT INTO records (key, value, expires_at) VALUES (?1, ?2, ?3) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
    )
    .bind(key, value, expiresAt)
    .run();
}

export async function d1Purge(now: number): Promise<void> {
  await db().prepare("DELETE FROM records WHERE expires_at <= ?1").bind(now).run();
  await db().prepare("DELETE FROM counters WHERE reset_at <= ?1").bind(now).run();
}

/** Counts one request in a fixed window, atomically, and returns the new count. */
export async function d1Hit(key: string, windowMs: number, now: number): Promise<number> {
  const row = await db()
    .prepare(
      "INSERT INTO counters (key, count, reset_at) VALUES (?1, 1, ?2) " +
        "ON CONFLICT(key) DO UPDATE SET " +
        "count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END, " +
        "reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END " +
        "RETURNING count",
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number }>();
  return row?.count ?? 1;
}
