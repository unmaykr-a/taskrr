-- Per-task folder: a single optional group name used to organise the task list
-- into collapsible sections. Empty means ungrouped.
ALTER TABLE tasks ADD COLUMN folder TEXT NOT NULL DEFAULT '';
