# OIDC Single Sign-On

Taskrr supports OpenID Connect for single sign-on, tested with **Authentik** and
**Pocket ID** (any standards-compliant provider should work). You can configure
it through environment variables, the admin UI, or both - environment values seed
the initial settings and the admin UI can change them later.

## Register the application with your provider

Create an OAuth/OIDC application in your identity provider and note:

- **Issuer URL** - for example `https://auth.example.com/application/o/taskrr/`.
- **Client ID** and **Client secret**.
- **Redirect URL** - your public origin plus `/api/auth/oidc/callback`, for
  example `https://taskrr.example.com/api/auth/oidc/callback`. It must match
  exactly on both sides.

Taskrr requests standard scopes and reads these claims: `sub` (the stable
subject), `preferred_username`, `email`, and `groups`.

## Configure Taskrr

Set these via environment (see [Configuration](Configuration)) or in the admin
settings:

| Setting | Env | Meaning |
| --- | --- | --- |
| Issuer | `TASKRR_OIDC_ISSUER` | The provider's issuer URL. |
| Client ID | `TASKRR_OIDC_CLIENT_ID` | The application's client id. |
| Client secret | `TASKRR_OIDC_CLIENT_SECRET` | The application's client secret. |
| Redirect URL | `TASKRR_OIDC_REDIRECT_URL` | The callback URL above. |
| Admin group | (admin UI: `oidc_admin_group`) | Group whose members become admins. |
| Link by username | (admin UI: `oidc_link_username`) | Link a first OIDC sign-in to an existing local account with the same username. |
| OIDC-only | (admin UI: `oidc_only`) | Hide local login and accept only SSO. |

Encrypt the client secret at rest by setting `TASKRR_SECRET_KEY`; otherwise it is
stored in plaintext (and would appear in backups). Changing the key makes an
existing stored secret unreadable, so re-enter it if you rotate the key.

## Account provisioning

- **First sign-in.** When **OIDC auto-provision** (`reg_oidc`) is on, a new user
  is created automatically on their first successful OIDC login. The username is
  taken from `preferred_username`, falling back to `email`, then the subject.
- **Linking to an existing account.** By default a new OIDC identity is its own
  account. Turn on **Link by username** (`oidc_link_username`) to link a first
  OIDC sign-in to an existing local account whose username matches. Users can
  also link/unlink SSO themselves from their account settings.
- **Stable identity.** Accounts are matched by the OIDC `subject`, so a username
  change at the provider does not detach the account.

## Group-to-admin-role mapping

Set an **admin group**. On each OIDC sign-in, group membership is synced to the
role:

- A user in the admin group is promoted to **admin**.
- If they are no longer in the group, they are demoted **only when their role is
  governed by OIDC** - that is, an account with no local password. An admin role
  granted locally (the account has a password) is never silently stripped, and
  the protected bootstrap admin is always left alone.

In other words: the group can grant and revoke admin for SSO-managed accounts,
but cannot remove a role you assigned by hand.

## OIDC-only mode

Turn on **OIDC-only** to make SSO the sole sign-in method:

- The login page hides the username/password form entirely and shows a single
  sign-on button.
- The server refuses local login, account claim, and registration, with the same
  message for known and unknown accounts (no user enumeration).
- The **protected bootstrap admin keeps password sign-in** as a break-glass path,
  so a provider outage cannot lock the instance out.
- The toggle is inert while OIDC is unconfigured, so enabling it prematurely
  cannot strand anyone.

## Endpoints

For reference, the OIDC flow uses:

- `GET /api/auth/oidc/login` - begin sign-in.
- `GET /api/auth/oidc/link` - begin linking from a signed-in account.
- `GET /api/auth/oidc/callback` - the provider redirect target.

See the [API Reference](API-Reference).

## Migrating local users to SSO

If a person has both a local and an OIDC account, an admin can **merge** them
(moving data to the target). See [Users and Authentication](Users-and-Authentication).
