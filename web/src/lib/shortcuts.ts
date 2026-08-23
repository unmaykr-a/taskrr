// shortcuts.ts — which key does what, and what a user is allowed to change it to.
//
// The shortcuts themselves are still deliberately single-key and unmodified
// (see useKeyboardShortcuts). What's new is that the four global ones are no
// longer fixed: "n" for a new task is fine on a QWERTY keyboard and awkward on
// some others, and "/" needs a shift on plenty of layouts.
//
// Only the four global actions are rebindable. Switching views stays on 1-9
// because those keys are positional — they follow the sidebar, which changes
// when sharing is enabled — so binding them individually would mean a setting
// that silently points somewhere else the moment the list changes.
//
// Pure and React-free, so the rules are testable (shortcuts.test.ts).

/** A rebindable action. `id` is what gets stored, so it must never change. */
export interface ShortcutAction {
  id: string;
  label: string;
  defaultKey: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "new", label: "New task", defaultKey: "n" },
  { id: "search", label: "Search tasks", defaultKey: "/" },
  { id: "help", label: "Show the shortcut list", defaultKey: "?" },
  { id: "clear", label: "Clear search and selection", defaultKey: "Escape" },
];

/** Digits switch views, so they can't be taken by anything else. */
export const RESERVED_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** The key currently bound to an action: the user's override, or the default. */
export function resolveKey(overrides: Record<string, string> | undefined, id: string): string {
  const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
  if (!action) return "";
  const custom = overrides?.[id];
  return custom && custom.trim() !== "" ? custom : action.defaultKey;
}

/** Every action with the key it's actually bound to right now. */
export function resolveAll(overrides: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, resolveKey(overrides, a.id)]));
}

/** Why a key can't be used, or null if it can. */
export type KeyProblem = "modifier" | "reserved" | "unprintable" | "taken";

/**
 * Whether `key` can be bound to `id`.
 *
 * Escape is allowed even though it's not printable — it's a default, and
 * "cancel" is exactly the thing people expect on it.
 */
export function checkKey(
  key: string,
  id: string,
  overrides: Record<string, string> | undefined,
): { problem: KeyProblem; takenBy?: string } | null {
  if (key === "") return { problem: "unprintable" };
  // Modifier keys pressed alone aren't a binding, they're half of one.
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab", "Dead"].includes(key)) {
    return { problem: "modifier" };
  }
  // Anything else with a name longer than one character is a named key. Only
  // the few that read as a shortcut are allowed through.
  const NAMED_OK = ["Escape", "Enter", " ", "Backspace", "Delete", "Home", "End"];
  if (key.length > 1 && !NAMED_OK.includes(key)) return { problem: "unprintable" };
  if (RESERVED_KEYS.includes(key)) return { problem: "reserved" };

  const clash = SHORTCUT_ACTIONS.find((a) => a.id !== id && resolveKey(overrides, a.id) === key);
  if (clash) return { problem: "taken", takenBy: clash.label };
  return null;
}

/** How to write a key on screen. */
export function describeKey(key: string): string {
  if (key === " ") return "Space";
  if (key === "Escape") return "Esc";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  return key;
}

/** A message explaining a problem, for the UI. */
export function explainProblem(p: { problem: KeyProblem; takenBy?: string }): string {
  switch (p.problem) {
    case "modifier":
      return "That's a modifier on its own — press the key you want to use.";
    case "reserved":
      return "The number keys switch views, so they can't be reassigned.";
    case "unprintable":
      return "That key can't be used as a shortcut.";
    case "taken":
      return `Already used by "${p.takenBy}".`;
  }
}

/** Drop overrides that match the default, so stored prefs stay minimal. */
export function pruneOverrides(overrides: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of SHORTCUT_ACTIONS) {
    const v = overrides[a.id];
    if (v && v !== a.defaultKey) out[a.id] = v;
  }
  return out;
}
