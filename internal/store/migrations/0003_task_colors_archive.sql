-- Per-task customisation + archiving.
--
-- color_fresh / color_overdue let a task override the two ends of the staleness
-- gradient (the colour shown right after it's done vs. once it's overdue).
-- NULL means "use the app-wide default", so existing tasks are unaffected and
-- the columns stay cheap. Stored as "#rrggbb" hex — the only thing the colour
-- inputs speak — validated at the API layer.
--
-- archived_at is a soft-archive: NULL = active, an RFC3339 timestamp = archived.
-- Archiving hides a task from the normal views without destroying its history
-- (unlike delete), and it can be un-archived. We keep the whole row so counts,
-- the calendar, and completion history remain intact.
ALTER TABLE tasks ADD COLUMN color_fresh   TEXT;
ALTER TABLE tasks ADD COLUMN color_overdue TEXT;
ALTER TABLE tasks ADD COLUMN archived_at   TEXT;
