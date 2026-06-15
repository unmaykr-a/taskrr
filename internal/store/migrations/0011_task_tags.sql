-- Per-task tags: a JSON array of short labels, used for filtering and grouping
-- in the UI. Stored as text so it adds cleanly to an existing DB.
ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
