-- Phase 2: authentication, multiple users, and per-user task ownership.
--
-- Local accounts have a password_hash; OIDC-only accounts have a NULL hash and a
-- non-NULL oidc_subject (Authentik's stable "sub"). Either identifier is unique.
-- Sessions are server-side: we store only the SHA-256 of the cookie token, so a
-- database leak can't be replayed. Settings is a small key/value store for
-- admin-editable config (registration toggles, OIDC settings).

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,                              -- NULL for OIDC-only accounts
    role          TEXT NOT NULL DEFAULT 'user',      -- 'admin' | 'user'
    oidc_subject  TEXT UNIQUE,                       -- Authentik 'sub', NULL for local
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,                     -- SHA-256 of the cookie value
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Per-user ownership. Nullable so the column adds cleanly to an existing DB; the
-- app's bootstrap assigns any pre-auth (orphan) tasks to the first admin.
ALTER TABLE tasks ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_tasks_owner ON tasks (owner_id);
