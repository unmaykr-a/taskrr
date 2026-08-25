// releases.ts — the in-app changelog data. Kept terse and curated (separate
// from the developer CHANGELOG.md) so the version menu and the post-update
// "what's new" dialog can render it with per-change icons.
//
// To add a release: bump the version in web/package.json and prepend one entry
// to RELEASES below. That is the only maintenance step — releases.test.ts fails
// if the top entry does not match the current version, so it can't be forgotten,
// and the what's-new dialog derives "changes since version X" from this list
// (any gap, e.g. 1.10.1 -> 1.15.7, shows every release in between).

declare const __APP_VERSION__: string;

export type ChangeKind = "feature" | "fix";

export interface Change {
  text: string;
  kind: ChangeKind;
  /** Optional grey explanation shown after the change as "- ...". */
  note?: string;
}

export interface Release {
  version: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  changes: Change[];
}

// `typeof` guard so this never throws if the define is absent (e.g. a test
// runner without Vite's replacement); the real build always substitutes it.
export const CURRENT_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

const feat = (text: string, note?: string): Change => ({ text, kind: "feature", note });
const fix = (text: string, note?: string): Change => ({ text, kind: "fix", note });

// Newest first. Keep the headline short; put the explanation in the note.
export const RELEASES: Release[] = [
  {
    version: "1.24.0",
    date: "2026-08-25",
    changes: [
      feat(
        "Invitation links for new accounts",
        "Adding someone without a password now gives you a link to send them. Opening it lets them choose their own password and signs them in. A link works once and lasts a week; there is a button beside each account to issue a new one when it runs out or never arrives. On a brand-new instance with no admin password preset, the server prints its own setup link in the log.",
      ),
      fix(
        "An account waiting to be set up could be claimed by anyone who knew the username",
        "Usernames are meant to be known - they appear on shared tasks and in folder members - so knowing one was enough to set the password on an account whose owner had not signed in yet. Setting that first password now takes the invitation link.",
      ),
      fix(
        "Reverse-proxy headers believed no matter who sent them",
        "The client IP is read from X-Forwarded-For and CF-Connecting-IP, which anyone can write. It is now trusted only when the connection came from where a proxy actually runs, so an instance published straight to the internet can no longer be fed an invented address to slip past the sign-in rate limit. Behind a proxy nothing changes.",
      ),
      feat(
        "Reminder webhooks can be kept off your local network",
        "They can reach your LAN by default, since a local ntfy or Home Assistant is the usual reason to set one up. On an instance where you don't know everyone with an account, TASKRR_WEBHOOK_ALLOW_PRIVATE=false restricts them to the public internet.",
      ),
      fix(
        "The window tab strip ignoring which layout you were in",
        "It always started 15rem in, as though the full sidebar were there — leaving a gap beside the icon rail, and a bigger one under the top bar, where there is no column at all. It now starts where the page does, including when the sidebar is folded away.",
      ),
      fix(
        "The changelog opening underneath the windows",
        "It blocked everything behind it, as a dialog should, while sitting below any window opened after the first — so the thing you had just opened was buried and nothing else would respond.",
      ),
      fix(
        "Signing out flashing the stock look",
        "The sign-in screen appeared in the built-in colours and name for a moment before redrawing as this instance. Its own look is the server's, not the account's, so it no longer goes away with the account.",
      ),
      feat(
        "Downloadable builds for every release",
        "Each release now has binaries for Linux, macOS and Windows with checksums, alongside the container image. One file, the web interface included, nothing to install beside it.",
      ),
    ],
  },
  {
    version: "1.23.2",
    date: "2026-08-25",
    changes: [
      fix(
        "Settings scrolling as one sheet",
        "The section scrolls on its own now; the list of sections and the rule beside it stay where they are. Scrolling a long page used to carry the way out of it off the top of the window.",
      ),
      fix(
        "The top bar's tabs sitting out of line with the page",
        "The name beside the mark pushed the whole row inward, away from the heading and search box directly beneath it. The mark alone stays, at the same margin as everything else, and takes you to All tasks.",
      ),
      fix(
        "Mode and Style not sliding like every other choice",
        "Both were built before the shared control existed and never caught up. They use it now, so the filled pill glides the way it does everywhere else.",
      ),
      fix(
        "A setting snapping back when changed right after signing in",
        "Your account's saved preferences arriving a moment later would overwrite the choice you had just made. The change you made wins, and is what gets saved.",
      ),
    ],
  },
  {
    version: "1.23.1",
    date: "2026-08-25",
    changes: [
      fix(
        "A background surviving a restore that predates it",
        "Restoring an older backup left the picture on screen, with the settings saying it was on while the list of images was empty. Preferences the restored account has never heard of now go back to their defaults instead of lingering from the browser, a pick that points at a missing image falls back on its own, and images are revalidated rather than cached for a week under an id a restore can hand to a different picture.",
      ),
      fix(
        "The sign-in card keeping round corners on a phone under the flat style",
        "The rule that squares everything off read the card's `sm:rounded-none` as if the card were already square, and skipped it — so it stayed round at the width where that variant doesn't apply.",
      ),
      fix(
        "Nowhere to find the version in the rail and top-bar layouts",
        "It sits at the foot of the settings window in the layouts without a sidebar footer, and still opens the changelog.",
      ),
    ],
  },
  {
    version: "1.23.0",
    date: "2026-08-25",
    changes: [
      feat(
        "Alternative layouts",
        "Experimental: keep the sidebar, narrow it to a column of icons, or drop it for a row of tabs across the top with the content full width. All three work on a phone as well. Set your own under Theme \u2192 Layout, or set the instance's under Admin \u2192 Branding.",
      ),
      feat(
        "The instance can set its own style and layout",
        "Under Branding, alongside the name and the icon. It applies to the sign-in page and to anyone who hasn't picked for themselves, so an instance looks like itself from the login screen onwards.",
      ),
      feat(
        "Background upload limits are yours to set",
        "Per image and per account, under Admin \u2192 Advanced \u2014 what counts as too big depends on the box it's running on. SVG can be allowed there too; it stays off by default and is served sandboxed when on.",
      ),
      fix(
        "The flat style missing dialogs, menus and the sign-in page",
        "It squared off what it could see and left the rest: dialogs kept rounded corners because their radius only applies above a screen width, and the sign-in page had no way to know the instance was flat at all. Both follow now, and the whole interface was swept for anything still round or shadowed.",
      ),
    ],
  },
  {
    version: "1.22.0",
    date: "2026-08-25",
    changes: [
      feat(
        "A picture behind the app",
        "Upload your own wallpaper under Theme \u2192 Background image, pick how it fills the screen, and dim it until the text on top is comfortable. Admins can set one for the whole instance \u2014 it shows on the login page too \u2014 and can turn the per-user side off entirely.",
      ),
      feat(
        "Flat interface styles",
        "Experimental, behind TASKRR_EXPERIMENTAL=true: squared-off corners, no shadows, no frosted glass, with two plain presets to go with it. It restyles every element in the app, which is why it takes a deliberate switch rather than arriving with an update.",
      ),
      feat(
        "Fold the sidebar away",
        "A collapse button in the sidebar, and the menu button in the header brings it back \u2014 worth about another column of tasks on a wide screen.",
      ),
      fix(
        "Auto columns ignoring the room they actually had",
        "The column count stepped at screen widths, so hiding the calendar gave the list more space without a fourth column ever appearing. It now fits as many as the space in front of it will take, and you can pick up to six by hand.",
      ),
    ],
  },
  {
    version: "1.21.0",
    date: "2026-08-23",
    changes: [
      feat(
        "Revoke every API token at once",
        "If you think a token has leaked and don't know which one it is, there's now one button for all of them under Account \u2192 API tokens.",
      ),
      feat(
        "Take a share back",
        "The owner of a shared task can remove someone from it, the same way folder sharing already worked. Sending an invite to the wrong username used to be the recipient's to decline.",
      ),
      fix(
        "Changing a password leaving API tokens working",
        "Changing your password signs out your other devices and now revokes your tokens with them, and an admin terminating an account's sessions does the same.",
      ),
      fix(
        "Exports opening as formulas in a spreadsheet",
        "A task name starting with =, + or @ was handed to Excel or LibreOffice as something to run. Cells that start that way are quoted in the CSV now, which matters most for a name someone else chose on a task shared with you.",
      ),
      fix(
        "Two API details that didn't match the rest",
        "Removing someone from a shared folder is DELETE /api/folders/{folder}/members/{userId} rather than a DELETE carrying a body, and asking for the members of a folder you don't have answers 404 instead of an empty list.",
      ),
    ],
  },
  {
    version: "1.20.1",
    date: "2026-08-23",
    changes: [
      fix(
        "The sidebar scrolling as one piece",
        "With a lot of folders the name, the New task button and the account and Settings row all scrolled away with the list. Only the views and folders scroll now; everything above and below stays put.",
      ),
      fix(
        "The folder list being easy to miss",
        "Folders sat directly under the views in the sidebar and looked like more of them. They now have a heading and a line above them, and a clear link while one is filtering the list.",
      ),
    ],
  },
  {
    version: "1.20.0",
    date: "2026-08-23",
    changes: [
      feat(
        "Task templates",
        "Right-click a task and save its setup as a template, then start a new task from it. Handy for the things you add regularly \u2014 a new houseplant, a new bike \u2014 where there's nothing to duplicate from yet.",
      ),
      feat(
        "Filter by folder",
        "Folders are listed in the sidebar with a count each. Picking one narrows whichever view you're in, the same way clicking a tag does.",
      ),
      feat(
        "Set a routine on several tasks at once",
        "The bulk bar can now set or clear a routine across a selection, alongside tagging and moving.",
      ),
      fix(
        "Windows that could be squeezed until the contents broke",
        "Panels inside a window now lay themselves out against the window's width rather than the screen's, so a narrow window gets the stacked layout instead of a side nav crushing the text into single-word lines.",
      ),
      fix(
        "Dragging a window selecting the page text behind it",
      ),
    ],
  },
  {
    version: "1.19.0",
    date: "2026-08-23",
    changes: [
      feat(
        "A colour per tag",
        "Give the tags you use most their own colour under Preferences \u2192 Tag colours. Anything you don't colour keeps the plain chip.",
      ),
      feat(
        "Panels instead of windows",
        "Turn off draggable windows and settings become plain full-screen menus with a title and a close button \u2014 no taskbar, no minimising. Phones always get this now.",
      ),
      fix(
        "The login page layout always showing \"Centred card\"",
        "The setting saved correctly but the dropdown reset itself every time the admin page opened, so it looked like it hadn't stuck.",
      ),
      fix(
        "Registration and single sign-on hidden behind a drawer",
        "They're the first thing you set up, so they now sit open on the admin page like the rest of the first-run settings.",
      ),
    ],
  },
  {
    version: "1.18.0",
    date: "2026-08-23",
    changes: [
      feat(
        "Change the keyboard shortcuts",
        "A Shortcuts page in Settings, where you press the key you'd rather use. It won't let you take a key something else already has, and the number keys stay with the sidebar views. Only appears when shortcuts are switched on.",
      ),
      feat(
        "Two more login page layouts",
        "As well as the centred card, the sign-in form can sit in a panel down the left or right, with the background filling the rest. Under Admin \u2192 Branding.",
      ),
      feat(
        "Lite mode hides more",
        "With lite mode on there is nobody to share with, so task sharing, theme sharing, the site default theme, other accounts and account merging all go rather than sitting there doing nothing.",
      ),
      fix(
        "Settings that were a wall of closed drawers",
        "Time & date and Sign-in are out in the open again \u2014 they're the ones you'd open every time anyway.",
      ),
      fix(
        "Leftover lines in the admin settings",
        "Hiding a section left its separator behind, so lite mode and a quiet instance both ended up with stray rules. The admin page now uses the same groups as the rest of Settings and has none.",
      ),
    ],
  },
  {
    version: "1.17.1",
    date: "2026-08-23",
    changes: [
      feat(
        "Settings, tidied up",
        "All three settings pages are now short lists of groups you open rather than one long scroll of switches. Nothing has gone \u2014 Task statistics is under Layout, the right-click, keyboard and quick-add switches are under Shortcuts & input, and whichever group you leave open stays open next time.",
      ),
    ],
  },
  {
    version: "1.17.0",
    date: "2026-08-23",
    changes: [
      feat(
        "Undo a log you didn't mean",
        "Quick log is one tap, and the wrong tap is easy. The confirmation now has an Undo on it, which puts the task back exactly as it was \u2014 no trip through Manage \u2192 History.",
      ),
      feat(
        "Right-click in the calendar too",
        "Click a day and the tasks listed under it get the same menu the cards have.",
      ),
      feat(
        "A Today button on the calendar",
        "Getting back from a wander through last spring used to mean pressing the arrow as many times as it took.",
      ),
      feat(
        "Snooze and skip a whole selection",
        "Both are in the bulk bar now. Skip only touches the tasks that actually have a routine, so a mixed selection does the sensible thing.",
      ),
      feat(
        "Bring your tasks from another tracker",
        "Import a CSV and say which column is the name, which is the cadence, and so on. Taskrr guesses from the headers first, and shows you what each row will become before anything is imported.",
      ),
      feat(
        "The demo has seasons",
        "The sample list now matches the time of year, and you can switch between spring, summer, autumn and winter from the banner.",
      ),
      fix(
        "The right-click menu flying in from off-screen",
        "It was being drawn off-screen first and then animated into place. It now opens where you clicked.",
      ),
      fix(
        "The right-click menu hanging off the bottom",
        "Near the bottom of the screen it worked out where to go while it was still mid-animation, and got the size wrong by 5%.",
      ),
      fix(
        "Accent colours that were hard to read",
        "Where your accent colour is used as *text* \u2014 the selected sidebar item, mostly \u2014 it now gets nudged until it's properly readable. Blocks of the colour are untouched, so what you picked is still what you see.",
      ),
    ],
  },
  {
    version: "1.16.0",
    date: "2026-08-23",
    changes: [
      feat(
        "Right-click a task",
        "Right-click (or long-press on a phone) any task for its actions \u2014 log, snooze, skip, pin, duplicate, archive, delete. Prefer your browser's own menu? Turn it off under Preferences \u2192 Right-click menu.",
      ),
      feat(
        "Snooze and skip",
        "Put a task off for an hour, a day, or a date you pick, and it stops counting as due (and stops sending reminders) until then. \"Skip this cycle\" moves the next due date on by one routine \u2014 without recording that you did it.",
      ),
      feat(
        "Share a whole folder",
        "Share a folder once instead of a task at a time. Anything you add to it later is included automatically, and moving a task out takes it back.",
      ),
      feat(
        "Whose turn is it",
        "Turn on \"Take turns\" for a shared task and each card says who's up next, moving along every time someone logs it.",
      ),
      feat(
        "Restore from a backup file",
        "Import a JSON export back into your account, either alongside what's there or replacing it. The other half of the export added in 1.15.",
      ),
      feat(
        "Pin and duplicate",
        "Keep a task at the top of the list whatever the sort, and copy a task's setup \u2014 without copying its history.",
      ),
      feat(
        "Quick add",
        "Type \"water plants every 2 weeks #home\" and Taskrr offers to fill in the routine, tags and folder. It only ever offers; one click accepts.",
      ),
      feat(
        "Reminders per task",
        "A task can now have its own lead time \u2014 a day before the NAS backup, an hour before the bins \u2014 instead of one setting for everything.",
      ),
      feat(
        "Add to your home screen",
        "Taskrr can now be installed to a phone's home screen. There's an optional count of what's due in the browser tab, too.",
      ),
      fix(
        "Setting a routine from outside the form",
        "The routine field ignored a value set for it by anything other than typing, which is why quick add's suggestion left the routine switched off.",
      ),
    ],
  },
  {
    version: "1.15.0",
    date: "2026-08-22",
    changes: [
      feat(
        "Task statistics",
        "A task's Manage window now shows how it actually goes: the typical gap between times you did it, the longest gap, and how that compares to its routine. Turn it off under Preferences \u2192 Task statistics.",
      ),
      feat(
        "Activity chart range",
        "Switch the chart between 7 days, 30 days, 90 days and a year. A year groups into weeks so it stays readable.",
      ),
      feat(
        "Keyboard shortcuts",
        "Press ? for the list. n for a new task, / to search, 1-9 to switch views, Esc to clear. Turn them off under Preferences \u2192 Keyboard shortcuts.",
      ),
      feat(
        "Bulk tags and folders",
        "Select several tasks and add a tag or move them to a folder in one go. Tagging adds to what each task already has rather than replacing it.",
      ),
      feat(
        "Log onto a past day",
        "Click any past day in the calendar to record something you did then, without opening the task first.",
      ),
      feat(
        "Export your data",
        "Download every task and its full history as JSON or CSV, from Settings \u2192 Account.",
      ),
      feat(
        "API tokens",
        "Log a task from a script, an NFC tag, or your home automation. A token reaches your tasks and history only \u2014 never the admin area or your password. Admins can switch the feature off instance-wide.",
      ),
      feat(
        "Background effects",
        "Constellations and drifting dots are now in the background picker. Constellations shipped with the midnight preset but could never be chosen \u2014 and picking anything else lost it for good.",
      ),
      fix(
        "Light theme readability",
        "Secondary text, task status labels and overdue dates were too faint on light themes to meet the usual contrast standard. They now stay readable while keeping their colour.",
      ),
    ],
  },
  {
    version: "1.14.1",
    date: "2026-06-16",
    changes: [
      fix(
        "Background pausing",
        "With smooth scrolling and pause-on-scroll both on, the animated background no longer flickers off and on at the end of a scroll. It now stays paused for the whole smooth scroll and resumes once.",
      ),
      fix(
        "Settings divider",
        "The divider line in the settings window now runs the full height instead of stopping where the section's content ends.",
      ),
    ],
  },
  {
    version: "1.14.0",
    date: "2026-06-16",
    changes: [
      feat(
        "In-app dialogs",
        "Confirmations and prompts now use themed in-app dialogs instead of the browser's pop-ups. Prefer the native ones? Turn on \"Use browser dialogs\" in Preferences.",
      ),
      fix(
        "Sidebar height",
        "On shorter desktop layouts the sidebar now stays put and fills the viewport instead of scrolling away with the page.",
      ),
      fix(
        "Smooth scrolling",
        "The end of a smooth scroll no longer flickers the animated background off and on when it pauses on scroll.",
      ),
    ],
  },
  {
    version: "1.13.0",
    date: "2026-06-16",
    changes: [
      feat(
        "Project links",
        "The changelog now links to the project's GitHub repository and a Ko-fi page for supporting development.",
      ),
    ],
  },
  {
    version: "1.12.1",
    date: "2026-06-15",
    changes: [
      fix(
        "Changelog scrolling",
        "Dragging the scrollbar in the changelog no longer fights an in-progress smooth-scroll and snaps back.",
      ),
      fix(
        "Version label",
        "Removed the static change-count badge next to the version, which never changed or cleared.",
      ),
    ],
  },
  {
    version: "1.12.0",
    date: "2026-06-15",
    changes: [
      feat(
        "Reminders for shared tasks",
        "Members of a shared task now get their own due reminders (if they've set a webhook), not just the owner — each reminded independently.",
      ),
      fix(
        "Shared badge",
        "A task is marked shared only once an invite is accepted; a pending invite alone no longer badges it.",
      ),
    ],
  },
  {
    version: "1.11.0",
    date: "2026-06-15",
    changes: [
      feat(
        "Shared tasks",
        "Share a task with another user so you both see and log it, with who-logged-last tracked. Owners invite by username; members can leave. Admins enable it under Admin settings.",
      ),
      feat(
        "Requests and opt-out",
        "Incoming shares wait under a Requests view to accept or decline, and you can opt out of receiving shares in your account settings.",
      ),
      feat(
        "Tags",
        "Label a task with one or more tags, then click a tag chip (or use search) to filter the list. Manage tags in the task's dialog.",
      ),
      feat("Search", "A search box filters tasks by name, description, or tag as you type."),
      feat("Sorting", "Order the list by name, most or least recently done, or newest, from the toolbar."),
      feat(
        "Folders",
        "Give a task a folder, then turn on Group in the toolbar to collapse the list into a section per folder.",
      ),
      feat(
        "In-app changelog",
        "The version number in the sidebar opens this changelog and shows each release's date.",
      ),
      feat(
        "What's new on update",
        "After an update you get a one-off summary of everything that changed since you last opened the app.",
      ),
      feat(
        "Update check",
        "Admins can check whether a newer version has been released. It only reports what's available and never updates the app itself.",
      ),
    ],
  },
  {
    version: "1.10.0",
    date: "2026-06-14",
    changes: [
      feat(
        "Instance branding",
        "Admins can set the app's name, browser-tab title, tagline, and icon under Admin settings.",
      ),
    ],
  },
  {
    version: "1.9.0",
    date: "2026-06-14",
    changes: [
      feat("Toasts", "Brief confirmations appear for common actions; turn them off in your preferences."),
    ],
  },
  {
    version: "1.8.0",
    date: "2026-06-14",
    changes: [
      feat("Calendar month/year picker", "Jump the calendar to any month or year from its header."),
      feat("User theme sharing", "Admins can let regular users publish their saved themes to everyone, not just admins."),
    ],
  },
  {
    version: "1.7.0",
    date: "2026-06-13",
    changes: [
      feat(
        "Custom date picker",
        "A built-in date and time picker, with its own preferences, used when logging or editing completions.",
      ),
      feat("Pop-out logs", "Admins can pop the server log view out into its own window."),
      feat(
        "Colour-fade toggle",
        "Turn off a task's fade to overdue when you only care that it was done, not how long ago.",
      ),
    ],
  },
  {
    version: "1.6.0",
    date: "2026-06-13",
    changes: [
      feat("Per-account themes", "Your theme follows your account across devices, and admins can force a default for everyone."),
      fix("Theme kept on logout", "Signing out no longer discards your customised theme."),
    ],
  },
  {
    version: "1.5.0",
    date: "2026-06-13",
    changes: [
      feat(
        "Safety backups",
        "A backup is taken automatically just before a restore, so a mistaken restore can be undone. Toggle it with TASKRR_SAFETY_BACKUP.",
      ),
      feat("Versioned images", "Container images are published per release, not just as latest."),
    ],
  },
  {
    version: "1.4.0",
    date: "2026-06-12",
    changes: [
      feat("OIDC-only sign-in", "Admins can require single sign-on and hide the password login."),
      feat("Wipe everything", "A true reset that clears all data while keeping the acting admin signed in."),
    ],
  },
  {
    version: "1.3.0",
    date: "2026-06-12",
    changes: [
      feat(
        "Encrypted OIDC secret",
        "The OIDC client secret is encrypted at rest when TASKRR_SECRET_KEY is set, so it isn't stored or backed up in plaintext.",
      ),
      feat("HSTS behind TLS", "The server sends HSTS when served over HTTPS through a trusted proxy."),
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-11",
    changes: [feat("Follows your clock", "Time and date formatting follow your device's locale by default.")],
  },
  {
    version: "1.1.0",
    date: "2026-06-11",
    changes: [
      feat(
        "Browser demo",
        "A no-backend demo of the whole app that runs entirely in your browser, behind the public demo site.",
      ),
    ],
  },
  {
    version: "1.0.0",
    date: "2026-06-11",
    changes: [
      feat(
        "First public release",
        "Last-done tracking with routines, a calendar, multiple users, OIDC, backups, reminders, and a themeable UI.",
      ),
    ],
  },
];

function parts(v: string): number[] {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}

/** Negative if a < b, zero if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function currentRelease(): Release | undefined {
  return RELEASES.find((r) => r.version === CURRENT_VERSION);
}

/** Releases strictly newer than `version` (drives the what's-new dialog). */
export function releasesSince(version: string): Release[] {
  return RELEASES.filter((r) => compareVersions(r.version, version) > 0);
}

/** Format an ISO release date for display (parsed as local midnight). */
export function formatReleaseDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
