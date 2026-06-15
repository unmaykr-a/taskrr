-- Shared tasks: a task is shared by attaching additional members to it, while
-- it stays a single row owned by tasks.owner_id. Members are rows in
-- task_shares; there are no copies to keep in sync.
--
-- This model makes the delete semantics fall out naturally: a member leaving is
-- just deleting their share row, and the task plus its history persist for
-- whoever remains. When the owner "deletes" a task that still has accepted
-- members, ownership transfers to the earliest member instead of destroying it
-- (handled in the application layer); only a task with no members is truly
-- removed.

CREATE TABLE task_shares (
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'pending'  = an invitation awaiting the recipient's response (their Requests)
    -- 'accepted' = an active member who sees and can log the task
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, user_id)
);
-- Listing a user's incoming requests / their shared tasks both filter by user.
CREATE INDEX idx_task_shares_user ON task_shares (user_id, status);

-- Who logged each completion. Nullable so the column adds cleanly to an existing
-- DB; backfilled to the task's owner so all prior history reads as "the owner did
-- it". New completions record the acting user. ON DELETE SET NULL keeps a shared
-- task's history intact when a member account is removed (the entry remains,
-- attributed to nobody) rather than cascading the row away.
ALTER TABLE completions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
UPDATE completions
   SET user_id = (SELECT owner_id FROM tasks WHERE tasks.id = completions.task_id)
 WHERE user_id IS NULL;

-- Per-user opt-out. When 0, the share API refuses to create a share targeting
-- this user, so opting out is enforced server-side rather than just hidden.
ALTER TABLE users ADD COLUMN allow_shares INTEGER NOT NULL DEFAULT 1;
