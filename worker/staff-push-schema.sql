-- スタッフ通知専用 D1。保護者テスト用DBとは分離する。
CREATE TABLE IF NOT EXISTS recipients (token TEXT PRIMARY KEY, uid TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS recipients_uid_idx ON recipients(uid);
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS send_state (uid TEXT PRIMARY KEY, last_attempt INTEGER NOT NULL DEFAULT 0);
