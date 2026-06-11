-- Phase 4: per-user reminders. When a cadence task is due (optionally a lead
-- time early), Taskrr delivers a webhook the user can point at ntfy, Apprise,
-- Gotify, a Discord/Slack webhook, Home Assistant, etc.
--
-- reminder_settings: one row per user — their webhook and when to fire.
-- task_reminders: the due-time a task was last reminded for, so each due cycle
-- (which advances whenever the task is completed again) notifies exactly once.

CREATE TABLE reminder_settings (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled      INTEGER NOT NULL DEFAULT 0,
    webhook_url  TEXT NOT NULL DEFAULT '',
    lead_seconds INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL
);

CREATE TABLE task_reminders (
    task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    due_at  TEXT NOT NULL,
    sent_at TEXT NOT NULL
);
