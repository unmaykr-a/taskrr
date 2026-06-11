-- Phase 2 (admin): track per-session activity so an admin can see who's online.
--
-- last_seen is bumped (throttled) on each authenticated request. Existing rows
-- are backfilled to their created_at so they don't read as "never seen".

ALTER TABLE sessions ADD COLUMN last_seen TEXT;
UPDATE sessions SET last_seen = created_at WHERE last_seen IS NULL;
