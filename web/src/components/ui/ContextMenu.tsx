import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { usePrefs } from "@/lib/prefs";

/**
 * ContextMenu — a right-click (or long-press) menu, hand-rolled.
 *
 * Radix has a context-menu package, but the app deliberately carries very few
 * dependencies and already hand-rolls its pickers, so this follows suit: a few
 * hundred bytes of positioning and key handling rather than another module in
 * the bundle.
 *
 * What it has to get right:
 *   - Open at the cursor, and stay on screen near an edge (flip, don't clip).
 *   - Close on outside click, Escape, scroll, resize, or a second right-click.
 *   - Be reachable without a mouse: arrow keys, Home/End, Enter, and the
 *     platform "menu" key, which browsers deliver as a contextmenu event.
 *   - Fall back to the browser's own menu when the user prefers it (the
 *     `contextMenu` preference) — copying a task name is a real use.
 *   - Work on touch, where there is no right button, via a long press.
 */

/** One row. A separator is `{ separator: true }`; everything else is an item. */
export type ContextMenuEntry =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      /** Renders in the destructive colour (delete and friends). */
      destructive?: boolean;
      disabled?: boolean;
    };

type Point = { x: number; y: number };

/** How long a touch must be held before it counts as a right-click. */
const LONG_PRESS_MS = 500;
/** How far a finger may drift during that hold before it reads as a scroll. */
const LONG_PRESS_SLOP = 10;

const EDGE_GAP = 8;

export function ContextMenu({
  entries,
  children,
  className,
  disabled = false,
}: {
  /** Built lazily on open, so labels can reflect current state ("Unpin"). */
  entries: () => ContextMenuEntry[];
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { prefs } = usePrefs();
  const [at, setAt] = useState<Point | null>(null);
  const [items, setItems] = useState<ContextMenuEntry[]>([]);
  const [active, setActive] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPress = useRef<{ timer: number; start: Point } | null>(null);

  const enabled = prefs.contextMenu && !disabled;

  const close = useCallback(() => {
    setAt(null);
    setActive(-1);
  }, []);

  const openAt = useCallback(
    (point: Point) => {
      const built = entries();
      if (built.length === 0) return;
      setItems(built);
      setAt(point);
      setActive(-1);
    },
    [entries],
  );

  // Keep the menu inside the viewport: flip up/left rather than letting it hang
  // off the edge, which is where a right-click near the bottom usually lands.
  useLayoutEffect(() => {
    if (!at || !menuRef.current) return;
    const el = menuRef.current;
    const { width, height } = el.getBoundingClientRect();
    let { x, y } = at;
    if (x + width > window.innerWidth - EDGE_GAP) x = Math.max(EDGE_GAP, x - width);
    if (y + height > window.innerHeight - EDGE_GAP) y = Math.max(EDGE_GAP, y - height);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [at, items]);

  // Dismissal. Scroll and resize close rather than reposition: a menu anchored
  // to a point the content has moved out from under is worse than no menu.
  useEffect(() => {
    if (!at) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // don't also trigger the app's global Escape
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [at, close]);

  const selectable = items
    .map((e, i) => (e.separator || e.disabled ? -1 : i))
    .filter((i) => i >= 0);

  const move = (delta: number) => {
    if (selectable.length === 0) return;
    const pos = selectable.indexOf(active);
    const next = pos < 0 ? (delta > 0 ? 0 : selectable.length - 1) : (pos + delta + selectable.length) % selectable.length;
    setActive(selectable[next]);
  };

  const run = (entry: ContextMenuEntry) => {
    if (entry.separator || entry.disabled) return;
    close();
    entry.onSelect();
  };

  const cancelLongPress = () => {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  };
  useEffect(() => cancelLongPress, []);

  return (
    <>
      <div
        className={className}
        onContextMenu={(e) => {
          if (!enabled) return; // let the browser's own menu through
          e.preventDefault();
          e.stopPropagation();
          // The keyboard "menu" key reports (0,0) or the element's corner;
          // anchoring to the element keeps it sensible either way.
          if (e.clientX === 0 && e.clientY === 0) {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openAt({ x: r.left + 8, y: r.top + 8 });
          } else {
            openAt({ x: e.clientX, y: e.clientY });
          }
        }}
        // Touch: a long press stands in for the right button. Cancelled by any
        // real movement, so scrolling a list never pops a menu.
        onPointerDown={(e) => {
          if (!enabled || e.pointerType !== "touch") return;
          const start = { x: e.clientX, y: e.clientY };
          cancelLongPress();
          longPress.current = {
            start,
            timer: window.setTimeout(() => {
              longPress.current = null;
              openAt(start);
            }, LONG_PRESS_MS),
          };
        }}
        onPointerMove={(e) => {
          const lp = longPress.current;
          if (!lp) return;
          if (Math.abs(e.clientX - lp.start.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - lp.start.y) > LONG_PRESS_SLOP) {
            cancelLongPress();
          }
        }}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
      >
        {children}
      </div>

      {at && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          tabIndex={-1}
          autoFocus
          // Positioned by the layout effect above; the initial offscreen spot
          // avoids a one-frame flash at the wrong place.
          style={{ left: -9999, top: -9999 }}
          className={cn(
            "fixed z-[60] w-52 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl outline-none",
            prefs.animWindows && "animate-in fade-in-0 zoom-in-95 duration-100",
          )}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Home") { e.preventDefault(); setActive(selectable[0] ?? -1); }
            else if (e.key === "End") { e.preventDefault(); setActive(selectable[selectable.length - 1] ?? -1); }
            else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (active >= 0) run(items[active]);
            }
          }}
          // A right-click on the menu itself should dismiss, not stack a second.
          onContextMenu={(e) => { e.preventDefault(); close(); }}
        >
          {items.map((entry, i) =>
            entry.separator ? (
              <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-border" />
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(entry)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  "disabled:pointer-events-none disabled:opacity-50",
                  entry.destructive ? "text-destructive" : "text-foreground",
                  active === i && (entry.destructive ? "bg-destructive/10" : "bg-accent"),
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
                  {entry.icon}
                </span>
                <span className="truncate">{entry.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
