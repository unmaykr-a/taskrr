-- Initial schema for Taskrr.
--
-- Design note: completions are an append-only log rather than a single
-- "last_done" column on the task. Storing every completion gives us free
-- history, per-completion notes, and future streak/graph features at no extra
-- cost. "Time since last done" is simply now() - MAX(completed_at).
--
-- Timestamps are stored as RFC3339 text in UTC; the application layer is the
-- single source of truth for their format so behaviour is identical across
-- architectures and SQLite builds.

CREATE TABLE tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE completions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
);

CREATE INDEX idx_completions_task_id ON completions (task_id);
CREATE INDEX idx_completions_recent ON completions (task_id, completed_at DESC);
