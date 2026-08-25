# Theming and Branding

Taskrr's interface is highly themeable per user, and admins can set an
instance-wide default and brand the instance identity.

## Per-user theming

From the floating theme customiser (a settings window) each user can adjust:

- **Colours** - an accent/colour picker with palette generation.
- **Light and dark** modes.
- **Fonts**.
- **A background image** of their own, plus **animated backgrounds** and
  frosted-glass effects, with per-animation toggles
  so you can dial motion up or down (handy on low-power hardware or for reduced
  motion).
- **Floating windows** for settings panels. Turn this off and panels become
  plain full-screen menus over a dimmed page, with a title and a close button
  and no taskbar - the same thing phones always get, since a desktop window
  metaphor with the dragging removed is nobody's idea of a good time.

Saved themes are stored per account on the server (not just in the browser), so
they follow you across devices and survive sign-out.

### Background image

A picture behind the app, under whichever animated effect is running (set the
effect to **None** for the picture on its own). Under **Settings -> Theme ->
Background image** you can:

- **Upload** PNG, JPEG, WebP, AVIF or GIF. The size limits (8 MB an image and
  40 MB an account by default) are set by the admin - see
  [Admin Guide](Admin-Guide#background-images). Uploads are yours alone; nobody
  else on the instance can see them.
- **Pick** one from your uploads, or **None** to have no picture at all even
  when the instance has one set.
- Choose how it sits: **fill the screen**, **fit inside**, or **tile**.
- **Dim** it. Text has to sit on top of a photograph, and this is the dial that
  makes that readable - the page colour is laid back over the picture at
  whatever strength you pick.

Images are stored in the database, so they are included in a backup and come
back with a restore - there is no second folder to remember.

Admins can turn the whole feature off (**Settings -> Admin -> What users may
do**), which hides the section and keeps everyone on the instance background.
See [Admin Guide](Admin-Guide).

### Interface style

Experimental - available only when the instance is started with
`TASKRR_EXPERIMENTAL=true` (see [Configuration](Configuration)).

**Soft** is Taskrr as it has always looked: rounded corners, shadowed panels,
optional frosted glass. **Flat** squares everything off and takes the depth out
- no drop shadows, no glass, no frosted chrome, borders doing the separating -
which is closer to how most self-hosted dashboards look, and easier on the eye
if Taskrr sits in a tab beside them all day. It covers the whole interface:
dialogs, menus, the taskbar, the toasts and the sign-in page included.

It is a shape, not a palette: any theme can be either, and the two `general`
presets are simply plain colour schemes that ship set to flat.

Three settings decide what you see, in this order:

1. **Your theme.** Under **Settings -> Theme -> Style**, pick Soft or Flat, or
   **Instance** to follow whatever the admin set.
2. **The instance.** Admins set one under **Branding** (below). It covers the
   sign-in page and everyone who hasn't chosen for themselves.
3. **The environment.** None of it exists unless the instance runs with
   `TASKRR_EXPERIMENTAL=true`. With the variable off, a theme carrying the flat
   style is applied with the ordinary shape and the choice is kept - turning it
   back on puts it back.

### Layout

Also experimental. Where the navigation lives, under **Settings -> Theme ->
Layout**:

- **Sidebar** - the full left column, with the folder list. The default, and
  what Taskrr has always been.
- **Icon rail** - the same column narrowed to icons with tooltips. Hands about
  11rem back to the task list, which on a wide screen is often another column
  of cards.
- **Top bar** - no side column: the views become tabs across the top and the
  content gets the full width.

The rail and the top bar have no room for a folder list, so a folder picker
appears in the toolbar beside the search box - the feature moves rather than
disappearing.

All three work on a phone: the rail is 4rem of a 24rem screen and the top bar's
tabs scroll sideways. Only the full sidebar is too wide to sit beside the list,
so that one (and only that one) is the drawer behind a menu button, as it has
always been.

Admins can set the instance's layout under **Branding**, and an account that
picks its own keeps it.

### Readability

Whatever accent you pick, the text drawn in it stays readable. Taskrr keeps two
versions of your accent: the colour itself, used wherever it is painted as a
block (buttons, the progress bar, the selected day), and a version nudged just
far enough to clear the WCAG AA contrast threshold, used wherever the accent is
drawn as *text* - the selected sidebar item, mostly.

That means a very pale or very dark accent still gives you legible text without
Taskrr quietly changing the colour you chose. If your accent is already readable
- most are - the two are the same colour and nothing is adjusted at all.

The same treatment applies to secondary text and to the staleness labels on
cards, which is why an overdue date on a light theme keeps its red without
becoming a pale smear.

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

## Login page layout (admin)

Under **Admin -> Branding**, the sign-in page has three layouts:

- **Centred card** - the default, and what Taskrr has always looked like.
- **Panel on the left** / **Panel on the right** - the form sits in a
  full-height panel down one side and the animated background gets the rest.
  Worth it if you've picked a background you actually want to see, since a small
  centred card hides most of it.

Phones get the same full-width form whichever you choose; there is no room for a
split and nothing to show beside it.

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
- **Background image** - a picture for the whole instance, shown behind the app
  and on the login page for anyone who has not picked their own. Upload it from
  the same panel; it lands in the admin's own collection and the setting points
  at it, so it can be reused personally as well. Removing it here leaves the
  file where it is; the picture currently in use can't be deleted until it is
  cleared.
- **Interface style** and **Layout** (experimental) - the shape and arrangement
  the instance uses. Both apply to the sign-in page and to every account that
  hasn't picked for itself, which is what makes a branded instance look like
  itself from the login screen onwards. The controls only appear when the
  instance runs with `TASKRR_EXPERIMENTAL=true`.
- **Login card toggles** - hide the icon and/or the name and tagline on the login
  page.

Branding is delivered as part of the public auth config, so the **signed-out
login page is branded too**.
