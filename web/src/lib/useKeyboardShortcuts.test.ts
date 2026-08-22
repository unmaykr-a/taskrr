import { describe, expect, it } from "vitest";

import { isTypingTarget } from "@/lib/useKeyboardShortcuts";

/** A stand-in for the parts of a KeyboardEvent the guard actually reads. */
function event(partial: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: Partial<HTMLElement> | null;
}): KeyboardEvent {
  return {
    key: partial.key ?? "n",
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    altKey: partial.altKey ?? false,
    target: partial.target ?? null,
  } as unknown as KeyboardEvent;
}

describe("isTypingTarget", () => {
  it("lets a bare key on a plain element through", () => {
    expect(isTypingTarget(event({ target: { tagName: "DIV", isContentEditable: false } }))).toBe(false);
    expect(isTypingTarget(event({ target: { tagName: "BUTTON", isContentEditable: false } }))).toBe(false);
  });

  it("stays out of the way in form fields", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTypingTarget(event({ target: { tagName, isContentEditable: false } }))).toBe(true);
    }
  });

  it("stays out of the way in contenteditable regions", () => {
    expect(isTypingTarget(event({ target: { tagName: "DIV", isContentEditable: true } }))).toBe(true);
  });

  it("never steals a modified keystroke from the browser or OS", () => {
    const plain = { tagName: "DIV", isContentEditable: false };
    expect(isTypingTarget(event({ target: plain, ctrlKey: true }))).toBe(true);
    expect(isTypingTarget(event({ target: plain, metaKey: true }))).toBe(true);
    expect(isTypingTarget(event({ target: plain, altKey: true }))).toBe(true);
  });

  it("treats a missing target as safe to handle", () => {
    expect(isTypingTarget(event({ target: null }))).toBe(false);
  });
});
