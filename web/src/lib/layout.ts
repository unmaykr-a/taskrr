// layout.ts — how the app arranges its navigation.
//
// Experimental, like the flat styles: these change where everything is rather
// than how it looks, so they are only offered on an instance that opted in.
//
// Three arrangements, all of them things a self-hosted app is expected to be:
//
//   sidebar  the full left column Taskrr has always had — labels, counts and
//            the folder list all visible at once.
//   rail     the same column narrowed to icons. Keeps navigation one click
//            away while handing the list back ~11rem; folders move to a picker
//            in the toolbar, since an icon can't say "Kitchen".
//   topbar   no side column at all: the views become tabs across the top and
//            the content gets the full width. The arrangement to pick if you
//            mostly read the list and rarely switch views.
//
// All three work on a phone — the rail is 4rem of a 24rem screen, the tabs
// scroll sideways — so the layout you picked is the layout you get on the
// device you actually carry. Only the full sidebar is too wide to sit beside
// the list there, which is why that one alone becomes a drawer.
//
// The layout is a per-account preference; an admin can set the instance's
// default, and "" means "follow whatever that is".

export type AppLayout = "sidebar" | "topbar" | "rail";

export const APP_LAYOUTS: { value: AppLayout; label: string; hint: string }[] = [
  { value: "sidebar", label: "Sidebar", hint: "The full left column, with folders" },
  { value: "rail", label: "Icon rail", hint: "A narrow column of icons" },
  { value: "topbar", label: "Top bar", hint: "Views as tabs, full-width content" },
];

/** Which layout actually renders: the account's choice, then the instance's,
 *  then the one Taskrr has always used. Anything unknown falls back rather
 *  than rendering nothing, and without the experimental switch there is only
 *  ever the sidebar. */
export function resolveLayout(
  preference: string | undefined,
  instance: string | undefined,
  experimental: boolean,
): AppLayout {
  if (!experimental) return "sidebar";
  for (const candidate of [preference, instance]) {
    if (candidate === "sidebar" || candidate === "rail" || candidate === "topbar") return candidate;
  }
  return "sidebar";
}

/** Width in pixels of the navigation column each layout puts down the left of
 *  the page, for the things that have to sit beside it rather than under it.
 *
 *  Only a column that takes space out of the page counts. The full sidebar is a
 *  drawer when compact — it floats over the content rather than displacing it —
 *  and it can be folded away entirely on desktop; the top bar has no column at
 *  all. In each of those cases the page starts at the screen edge, and so does
 *  anything lining up with it.
 *
 *  Kept here rather than measured, because the thing that needs it most (the
 *  window taskbar) is fixed to the viewport and so is outside the layout that
 *  would otherwise tell it. */
export function navColumnWidth(
  layout: AppLayout,
  { compact, collapsed }: { compact: boolean; collapsed: boolean },
): number {
  if (layout === "topbar") return 0;
  if (layout === "rail") return RAIL_WIDTH; // narrow enough to stay put on a phone
  if (compact || collapsed) return 0;
  return SIDEBAR_WIDTH;
}

export const SIDEBAR_WIDTH = 240; // w-60
export const RAIL_WIDTH = 64; // w-16
