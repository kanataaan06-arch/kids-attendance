-- Legacy singleton table is retained empty so this script is safely repeatable.
CREATE TABLE IF NOT EXISTS recipient (
  id INTEGER PRIMARY KEY CHECK (id = 1), uid TEXT NOT NULL,
  token TEXT NOT NULL, last_attempt INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recipients (
  token TEXT PRIMARY KEY, uid TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recipients_uid ON recipients(uid);
CREATE TABLE IF NOT EXISTS send_state (
  uid TEXT PRIMARY KEY, last_attempt INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
);
-- Preserve the existing phone and cooldown when upgrading the one-device test.
INSERT OR IGNORE INTO recipients(token,uid) SELECT token,uid FROM recipient;
INSERT INTO send_state(uid,last_attempt) SELECT uid,last_attempt FROM recipient WHERE true
ON CONFLICT(uid) DO UPDATE SET last_attempt=MAX(send_state.last_attempt,excluded.last_attempt);
DELETE FROM recipient;
