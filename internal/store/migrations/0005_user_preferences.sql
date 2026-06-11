-- Per-user preferences: the theme + layout/motion settings that used to live
-- only in the browser's localStorage. Storing them server-side, keyed by user,
-- means a person's look-and-feel follows their account across devices and never
-- bleeds between accounts sharing a browser. The payload is an opaque JSON blob
-- owned by the frontend, so adding new preference fields needs no migration.

CREATE TABLE user_preferences (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
