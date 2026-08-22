// useKeyboardShortcuts — the app's global single-key shortcuts.
//
// Deliberately single-key and unmodified: this is a personal tool, not an IDE,
// and chords would be more to remember than the app is worth. The whole set is
// behind a preference, and the handler stays out of the way of anything the
// user is actually typing into.

import { useEffect } from "react";

/** One binding: the key that triggers it, what it does, and how to describe it. */
export interface Shortcut {
  /** `event.key` to match, compared case-sensitively after the guards below. */
  key: string;
  /** Shown in the help overlay. */
  label: string;
  run: () => void;
}

/**
 * Whether a keystroke should be left alone because the user is typing.
 *
 * Text fields are the obvious case, but so is anything inside a contenteditable
 * region, and so is any keystroke carrying a modifier — those belong to the
 * browser or the OS (⌘L, ctrl-R) and stealing them would be hostile.
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Bind `shortcuts` to the document while `enabled`.
 *
 * Handlers are read from the array on every event rather than captured, so
 * callers can pass freshly-built closures each render without re-binding.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const hit = shortcuts.find((s) => s.key === e.key);
      if (!hit) return;
      // Only swallow the key once we know we're handling it, so unbound keys
      // still reach the page (and browser quick-find keeps working).
      e.preventDefault();
      hit.run();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, enabled]);
}
