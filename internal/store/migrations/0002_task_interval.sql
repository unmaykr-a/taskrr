-- Add an optional "cadence" to tasks: the desired amount of time between doing
-- them, stored in seconds.
--
-- NULL means "no cadence" — just track when it was last done, with no notion of
-- being due or overdue. A value (e.g. 604800 = 7 days) lets the UI colour the
-- task by how far through the interval it is, and compute a "next due" date.
--
-- We store seconds (not days) so any granularity works (hourly chores through
-- to yearly maintenance) using a single integer column.
ALTER TABLE tasks ADD COLUMN interval_seconds INTEGER;
