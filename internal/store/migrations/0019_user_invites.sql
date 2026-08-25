-- Invitations for admin-created accounts.
--
-- An account created without a password is waiting for its owner to set one.
-- Until now that was all it took: anyone who knew the username could set the
-- password first and walk in. The account now also carries a one-time secret
-- that has to be presented to claim it, so the invitation is the thing that
-- grants access rather than knowledge of a username.
--
-- Only the digest is stored, the way session and API tokens are: a copy of the
-- database is not a set of usable invitations. Both columns are cleared the
-- moment the account is claimed (or an admin sets a password on it), so a link
-- works exactly once.

ALTER TABLE users ADD COLUMN invite_hash TEXT;
ALTER TABLE users ADD COLUMN invite_expires_at TEXT;
