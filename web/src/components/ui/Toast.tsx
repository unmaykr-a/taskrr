import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { usePrefs } from "@/lib/prefs";

// A small, modular toast system. Call the function from useToast() to flash a
// brief message — either anchored just above a clicked element, or pinned to a
// screen corner/edge. Kept deliberately generic so any button can use it.

export type ToastPlacement =
  | "top-left"
  | "top-right"
  | "top-center"
  | "bottom-left"
  | "bottom-right"
  | "bottom-center";

export interface ToastOptions {
  /** Show the toast just above this element (e.g. the button that was clicked).
   *  Takes precedence over `placement`. */
  anchor?: HTMLElement | null;
  /** Fixed screen position when there's no anchor. Default "bottom-right". */
  placement?: ToastPlacement;
  /** Auto-dismiss after this many ms (default 2000, or 6000 with an action —
   *  two seconds is not long enough to read a message and decide to undo it). */
  duration?: number;
  /** Visual tone. */
  tone?: "default" | "success" | "error";
  /** An optional single action, e.g. "Undo". Dismisses the toast when chosen. */
  action?: { label: string; onSelect: () => void };
}

interface ToastItem {
  id: number;
  message: string;
  style: CSSProperties;
  tone: NonNullable<ToastOptions["tone"]>;
  action?: ToastOptions["action"];
}

type ShowToast = (message: string, opts?: ToastOptions) => void;

const ToastCtx = createContext<ShowToast>(() => {});

/** Returns `toast(message, opts?)`. Safe to call from anywhere under the app. */
export function useToast(): ShowToast {
  return useContext(ToastCtx);
}

let nextId = 1;
const MARGIN = 16;

// The fixed position of the toast's outer wrapper. The rise/fade animation
// lives on an inner element so it never fights this positioning transform
// (animating both on one node is what made the old toast slide in diagonally).
function positionFor(opts: ToastOptions): CSSProperties {
  // Anchored: float centred just above the element, in viewport coordinates
  // (the portal container is fixed at inset-0, so these map 1:1).
  if (opts.anchor) {
    const r = opts.anchor.getBoundingClientRect();
    return { left: r.left + r.width / 2, top: r.top - 8, transform: "translate(-50%, -100%)" };
  }
  const placement = opts.placement ?? "bottom-right";
  const style: CSSProperties = {};
  if (placement.startsWith("top")) style.top = MARGIN;
  else style.bottom = MARGIN;
  if (placement.endsWith("center")) {
    style.left = "50%";
    style.transform = "translateX(-50%)";
  } else if (placement.endsWith("left")) {
    style.left = MARGIN;
  } else {
    style.right = MARGIN;
  }
  return style;
}

const TONES: Record<NonNullable<ToastOptions["tone"]>, string> = {
  default: "border-border bg-card text-foreground",
  success: "border-emerald-500/40 bg-card text-foreground",
  error: "border-destructive/50 bg-card text-destructive",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const enabled = prefs.toasts;

  const show = useCallback<ShowToast>(
    (message, opts = {}) => {
      // Toasts turned off: the message goes, but an action would take a real
      // affordance with it, so fall back to nothing rather than a silent loss.
      if (!enabled && !opts.action) return;
      const id = nextId++;
      setToasts((cur) => [
        ...cur,
        { id, message, style: positionFor(opts), tone: opts.tone ?? "default", action: opts.action },
      ]);
      window.setTimeout(
        () => setToasts((cur) => cur.filter((t) => t.id !== id)),
        opts.duration ?? (opts.action ? 6000 : 2000),
      );
    },
    [enabled],
  );

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed inset-0 z-[100]">
          {toasts.map((t) => (
            // Outer node: fixed position. Inner node: the rise+fade, so the
            // animation can't disturb the positioning transform above.
            <div key={t.id} style={t.style} className="absolute">
              <div
                className={cn(
                  "flex max-w-[80vw] items-center gap-3 rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg",
                  "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
                  TONES[t.tone],
                )}
              >
                <span className="truncate">{t.message}</span>
                {t.action && (
                  // The wrapper is pointer-events-none so toasts never swallow
                  // a click; the one thing meant to be clicked opts back in.
                  <button
                    type="button"
                    className="pointer-events-auto shrink-0 rounded px-1.5 py-0.5 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setToasts((cur) => cur.filter((x) => x.id !== t.id));
                      t.action!.onSelect();
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
