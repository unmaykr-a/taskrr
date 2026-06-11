-- Per-task "freeze colour" toggle.
--
-- When set, the card's staleness colour stays at the "recent/fresh" end instead
-- of fading toward overdue over time — so a task the user wants to keep visually
-- green never goes red. It's purely a display preference: the cadence, due date,
-- and filters still reflect the real schedule.
--
-- Default 0 (off) so existing tasks are unchanged.

ALTER TABLE tasks ADD COLUMN freeze_color INTEGER NOT NULL DEFAULT 0;
