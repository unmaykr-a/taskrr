-- "Whose turn is it" on a shared task.
--
-- Opt-in per task, because plenty of shared tasks are not a rota — anyone can
-- water the plants — and a turn order nobody asked for is just noise.
--
-- Only the flag is stored. Whose turn it is is *derived* from the member order
-- and who logged last, so there is no pointer to drift out of sync when someone
-- joins, leaves, or logs out of turn. The rota is a reading of the history
-- rather than a second source of truth about it.

ALTER TABLE tasks ADD COLUMN rotate INTEGER NOT NULL DEFAULT 0;
