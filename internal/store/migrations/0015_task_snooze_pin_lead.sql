-- Three per-task attributes that all shift when a task next wants attention, or
-- where it sits in the list.
--
-- snoozed_until: "don't consider this due before T". It backs both "snooze
-- until a date" and "skip this cycle" — skipping is just a snooze set one
-- interval past the current due time — so the whole feature is one nullable
-- timestamp rather than two overlapping concepts. Everything downstream reads
-- it through the same rule: the effective due time is the later of
-- (last completion + interval) and snoozed_until.
--
-- pinned: keep a task at the top of the list regardless of the chosen sort.
--
-- reminder_lead_seconds: a per-task override for how far ahead of due its
-- reminder fires. NULL falls back to the account-wide setting, so existing
-- tasks keep behaving exactly as they did.

ALTER TABLE tasks ADD COLUMN snoozed_until TEXT;
ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN reminder_lead_seconds INTEGER;
