-- Optional registration approval: when the admin requires it, a self-registered
-- account starts unapproved and can't sign in until an admin approves it.
--
-- Default 1 ("approved") so every existing account — and accounts the admin
-- creates directly, and OIDC/provisioned accounts — are usable immediately;
-- only the local self-registration path sets this to 0 when approval is on.

ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;
