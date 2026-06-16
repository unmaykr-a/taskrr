# Theming and Branding

Taskrr's interface is highly themeable per user, and admins can set an
instance-wide default and brand the instance identity.

## Per-user theming

From the floating theme customiser (a settings window) each user can adjust:

- **Colours** - an accent/colour picker with palette generation.
- **Light and dark** modes.
- **Fonts**.
- **Animated backgrounds** and frosted-glass effects, with per-animation toggles
  so you can dial motion up or down (handy on low-power hardware or for reduced
  motion).
- **Floating windows** for settings panels.

Saved themes are stored per account on the server (not just in the browser), so
they follow you across devices and survive sign-out.

### Task colours

Task staleness colours - the fresh-to-overdue shading - are tunable policy:

- Set fresh and overdue colours **per task**, or globally.
- **Freeze** a task's colour so it stays put instead of fading.
- A global **"Fade colours over time"** preference applies the frozen behaviour
  to every task at once.

See [Tasks and Routines](Tasks-and-Routines).

### Pickers

Several input controls (colour wheel, date picker, time picker) can be switched
between Taskrr's custom widgets and the device's native inputs in preferences,
whichever you prefer.

## Instance default theme (admin)

Admins can publish a theme as the instance default:

- **Set as site default** - the theme shown to everyone by default, including on
  the signed-out login page.
- **Use the default for everyone** - accounts that have not customised their own
  theme follow the site default and pick up the admin's later changes. As soon as
  a user changes their theme, theirs takes over - it is a default, not a lock.

## Shared themes (admin)

When **theme sharing** is enabled, a **Share** button publishes a saved theme to
all users, where it appears in a Shared themes group and can be applied like a
preset. Admins can unshare. An additional toggle lets non-admin users share
themes too, not just admins.

## Branding (admin)

Customise the instance identity from the admin settings:

- **Name** - shown in the sidebar and on the login card.
- **Browser tab title** - sets the document title (defaults to the name when
  blank).
- **Tagline** - the small subtitle under the name.
- **Icon** - an uploaded image, downscaled client-side to a small PNG and used
  for the favicon, the sidebar mark, and the login card. Without one, Taskrr uses
  a generated accent checkmark. Uploaded icons are validated as images and capped
  in size on the server.
- **Login card toggles** - hide the icon and/or the name and tagline on the login
  page.

Branding is delivered as part of the public auth config, so the **signed-out
login page is branded too**.
