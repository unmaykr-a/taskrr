-- Reminders become per-recipient. A task can now be shared, and each member who
-- has reminders enabled should get their own reminder. The once-per-cycle dedup
-- therefore moves from being keyed by task_id alone to (task_id, user_id).
--
-- Existing dedup rows belonged to the task's owner (reminders were owner-only
-- before sharing), so they're carried over attributed to the current owner.

ALTER TABLE task_reminders RENAME TO task_reminders_old;

CREATE TABLE task_reminders (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    due_at  TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (task_id, user_id)
);

INSERT INTO task_reminders (task_id, user_id, due_at, sent_at)
    SELECT o.task_id, t.owner_id, o.due_at, o.sent_at
    FROM task_reminders_old o
    JOIN tasks t ON t.id = o.task_id;

DROP TABLE task_reminders_old;
