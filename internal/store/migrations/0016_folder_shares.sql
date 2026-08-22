-- Sharing a folder rather than a task at a time.
--
-- A household with a "Home" folder of fifteen chores otherwise needs fifteen
-- invitations, and every new chore needs another one. A folder share is an
-- agreement about a *name* within one owner's account: every task that owner has
-- in that folder is visible to the recipient, including ones created or moved
-- there afterwards.
--
-- Resolved at read time (see visibleTaskCond) rather than expanded into
-- per-task rows at share time. Expansion is simpler to write but drifts the
-- moment a task is moved into or out of the folder, and reconciling that drift
-- is exactly the kind of bookkeeping that goes wrong quietly.
--
-- Per-task shares are untouched: this is an additional, coarser grain, not a
-- replacement. A task can be reachable by both, which is why membership is
-- computed as a union rather than assumed to come from one source.

CREATE TABLE folder_shares (
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder     TEXT    NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted'
    created_at TEXT    NOT NULL,
    PRIMARY KEY (owner_id, folder, user_id)
);

CREATE INDEX idx_folder_shares_user ON folder_shares(user_id, status);
