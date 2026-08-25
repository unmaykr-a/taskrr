-- Background images: a static picture behind the app, instead of (or under) the
-- animated canvas effect.
--
-- Stored as a blob rather than a file on disk so a background travels with the
-- database: one file to back up, one file to restore, and no second volume to
-- remember when moving an instance. They are capped per upload and per account,
-- which keeps that decision honest.
--
-- Owned by a user like anything else here. The instance-wide background an
-- admin sets is a row like any other, pointed at by the brand_background
-- setting, so there is no second code path for "the admin's one".

CREATE TABLE backgrounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    mime       TEXT    NOT NULL,
    size       INTEGER NOT NULL,
    data       BLOB    NOT NULL,
    created_at TEXT    NOT NULL
);

CREATE INDEX idx_backgrounds_user ON backgrounds(user_id);
