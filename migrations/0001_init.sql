-- Checks, PayPal references, and rate-limit counters for the Cloudflare deployment.
-- Every record expires; expired rows are deleted as new checks are saved.
CREATE TABLE IF NOT EXISTS records (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_expires_at ON records (expires_at);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS counters_reset_at ON counters (reset_at);
