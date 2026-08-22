-- API tokens: long-lived bearer credentials so a script, an NFC tag, or a home
-- automation can log a task without driving a browser session.
--
-- Only the SHA-256 digest is stored, exactly as sessions do, so a database or
-- backup leak never yields a usable token. `name` is the user's own label for
-- where the token lives ("kitchen tablet"), which is what makes revoking the
-- right one possible later.

CREATE TABLE api_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL UNIQUE,
    created_at   TEXT    NOT NULL,
    last_used_at TEXT
);

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
