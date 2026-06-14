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
  /** Auto-dismiss after this many ms (default 2000). */
  duration?: number;
  /** Visual tone. */
  tone?: "default" | "success" | "error";
}

interface ToastItem {
  id: number;
  message: string;
  style: CSSProperties;
  enter: string;
  tone: NonNullable<ToastOptions["tone"]>;
}

type ShowToast = (message: string, opts?: ToastOptions) => void;

const ToastCtx = createContext<ShowToast>(() => {});

/** Returns `toast(message, opts?)`. Safe to call from anywhere under the app. */
export function useToast(): ShowToast {
  return useContext(ToastCtx);
}

let nextId = 1;
const MARGIN = 16;

function positionFor(opts: ToastOptions): { style: CSSProperties; enter: string } {
  // Anchored: float centred just above the element, in viewport coordinates
  // (the portal container is fixed at inset-0, so these map 1:1).
  if (opts.anchor) {
    const r = opts.anchor.getBoundingClientRect();
    return {
      style: { left: r.left + r.width / 2, top: r.top - 8, transform: "translate(-50%, -100%)" },
      enter: "slide-in-from-bottom-1",
    };
  }
  const placement = opts.placement ?? "bottom-right";
  const style: CSSProperties = {};
  const top = placement.startsWith("top");
  if (top) style.top = MARGIN;
  else style.bottom = MARGIN;
  if (placement.endsWith("center")) {
    style.left = "50%";
    style.transform = "translateX(-50%)";
  } else if (placement.endsWith("left")) {
    style.left = MARGIN;
  } else {
    style.right = MARGIN;
  }
  return { style, enter: top ? "slide-in-from-top-2" : "slide-in-from-bottom-2" };
}

const TONES: Record<NonNullable<ToastOptions["tone"]>, string> = {
  default: "border-border bg-card text-foreground",
  success: "border-emerald-500/40 bg-card text-foreground",
  error: "border-destructive/50 bg-card text-destructive",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback<ShowToast>((message, opts = {}) => {
    const id = nextId++;
    const { style, enter } = positionFor(opts);
    setToasts((cur) => [...cur, { id, message, style, enter, tone: opts.tone ?? "default" }]);
    window.setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, opts.duration ?? 2000);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed inset-0 z-[100]">
          {toasts.map((t) => (
            <div
              key={t.id}
              style={t.style}
              className={cn(
                "absolute max-w-[80vw] truncate rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg",
                "animate-in fade-in-0 zoom-in-95 duration-150",
                t.enter,
                TONES[t.tone],
              )}
            >
              {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
