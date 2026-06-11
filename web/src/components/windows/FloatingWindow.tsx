import { type ReactNode, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Maximize2, Minimize2, Minus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePrefs } from "@/lib/prefs";

const WIDTH = 460;
const MIN_W = 320;
const MIN_H = 220;

// setDragging flags a drag/resize in progress: it toggles a body class the
// Background watches (to pause the canvas so a frosted window's backdrop blur
// samples a static image and stays smooth) and notifies it to re-evaluate.
function setDragging(active: boolean) {
  document.body.classList.toggle("win-dragging", active);
  window.dispatchEvent(new Event("win-dragging-change"));
}

/** Track the coarse "is this a phone-sized screen" breakpoint reactively. */
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

/**
 * FloatingWindow is a draggable, non-modal panel. On desktop you move it by its
 * title bar, resize it from the bottom-right grip, and maximise it; it comes to
 * the front when touched (onFocus). Minimising sends it to the taskbar (the
 * window manager owns that state), and several can be open at once.
 *
 * On phones (<=640px) it becomes a full-screen sheet: dragging and resizing are
 * disabled and it simply fills the viewport.
 *
 * Dragging/resizing write straight to the DOM node inside requestAnimationFrame
 * rather than through React state, so movement stays smooth even on low-power
 * hardware. During a drag/resize the transform transition is disabled (so the
 * window tracks the cursor 1:1); when frosted glass is on, the background
 * animation also pauses so the backdrop blur samples a static image and stays
 * cheap on weaker client GPUs.
 */
export function FloatingWindow({
  title,
  children,
  index,
  width,
  savedSize,
  onResizeEnd,
  z,
  minimized,
  onClose,
  onMinimize,
  onFocus,
}: {
  title: string;
  children: ReactNode;
  index: number;
  width?: number;
  /** A remembered {w,h} to open at (overrides `width` and the auto height). */
  savedSize?: { w: number; h: number };
  /** Called with the final size when a resize ends, so it can be remembered. */
  onResizeEnd?: (size: { w: number; h: number }) => void;
  z: number;
  minimized: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onFocus: () => void;
}) {
  const isMobile = useIsMobile();
  const { prefs } = usePrefs();
  const elRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [peek, setPeek] = useState(false); // translucent so you can see behind it

  // Teardown for an in-flight drag/resize. The pointer listeners live on
  // `document`, so if the window unmounts mid-gesture (closed from the taskbar,
  // logout) they'd otherwise leak — and leave the win-dragging body class stuck.
  const gestureCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => gestureCleanup.current?.(), []);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  // A remembered size wins over the default width; clamp both to the viewport so
  // a size saved on a bigger screen can't open off-screen here.
  const initialW = Math.min(savedSize?.w ?? width ?? WIDTH, vw - 24);
  const initialH =
    savedSize?.h != null ? Math.max(MIN_H, Math.min(savedSize.h, vh - 16)) : null;
  const pos = useRef({
    x: Math.max(12, Math.min(vw - initialW - 12, vw / 2 - initialW / 2 + index * 28)),
    y: 72 + index * 28,
  });
  const size = useRef<{ w: number; h: number | null }>({ w: initialW, h: initialH });

  const floating = !isMobile && !maximized;
  // Static-panel mode: keep the window non-modal but not draggable/resizable.
  const draggable = floating && prefs.draggableWindows;

  function startDrag(e: React.PointerEvent) {
    onFocus();
    if (!draggable) return;
    const el = elRef.current;
    el?.classList.add("win-busy"); // disable the transition + promote the layer
    if (prefs.pauseBgOnDrag) setDragging(true); // pause the canvas so a frosted blur stays cheap
    const start = { px: e.clientX, py: e.clientY };
    let dx = 0;
    let dy = 0;
    let raf = 0;
    // During the drag we only mutate `transform` (a compositor-only property),
    // never left/top — so there's no layout/paint per frame and the window
    // tracks the cursor without lag, even on a low-powered client device.
    const apply = () => {
      raf = 0;
      if (el) el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };
    const onMove = (ev: PointerEvent) => {
      const tx = Math.max(-size.current.w + 120, Math.min(window.innerWidth - 80, pos.current.x + (ev.clientX - start.px)));
      const ty = Math.max(8, Math.min(window.innerHeight - 44, pos.current.y + (ev.clientY - start.py)));
      dx = tx - pos.current.x;
      dy = ty - pos.current.y;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const teardown = () => {
      if (raf) cancelAnimationFrame(raf);
      setDragging(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      gestureCleanup.current = null;
    };
    const onUp = () => {
      // Commit the delta to left/top and clear the transform. Suppress the CSS
      // transition for this one commit — otherwise resetting `transform` animates
      // back from the drag offset while left/top jump instantly, making the window
      // spring away and slide into place.
      pos.current = { x: pos.current.x + dx, y: pos.current.y + dy };
      if (el) {
        el.style.transition = "none";
        el.style.transform = "";
        el.style.left = `${pos.current.x}px`;
        el.style.top = `${pos.current.y}px`;
        void el.offsetHeight; // force a reflow so the no-transition commit lands
        el.style.transition = "";
        el.classList.remove("win-busy");
      }
      teardown();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    gestureCleanup.current = teardown;
  }

  function startResize(e: React.PointerEvent) {
    e.stopPropagation();
    onFocus();
    if (!draggable) return;
    const el = elRef.current;
    el?.classList.add("win-busy");
    if (prefs.pauseBgOnDrag) setDragging(true);
    const startH = el ? el.getBoundingClientRect().height : MIN_H;
    const start = { px: e.clientX, py: e.clientY, w: size.current.w, h: startH };
    let nw = start.w;
    let nh = startH;
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (el) {
        el.style.width = `${nw}px`;
        el.style.height = `${nh}px`;
      }
    };
    const onMove = (ev: PointerEvent) => {
      nw = Math.max(MIN_W, Math.min(window.innerWidth - 16, start.w + (ev.clientX - start.px)));
      nh = Math.max(MIN_H, Math.min(window.innerHeight - 16, start.h + (ev.clientY - start.py)));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const teardown = () => {
      if (raf) cancelAnimationFrame(raf);
      el?.classList.remove("win-busy");
      setDragging(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      gestureCleanup.current = null;
    };
    const onUp = () => {
      size.current = { w: nw, h: nh };
      onResizeEnd?.({ w: Math.round(nw), h: Math.round(nh) });
      teardown();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    gestureCleanup.current = teardown;
  }

  const style: React.CSSProperties = floating
    ? {
        left: pos.current.x,
        top: pos.current.y,
        width: size.current.w,
        height: size.current.h ?? undefined,
        zIndex: z,
      }
    : { zIndex: z };

  return (
    <div
      ref={elRef}
      role="dialog"
      aria-label={title}
      className={cn(
        "fixed flex flex-col overflow-hidden border bg-card shadow-2xl",
        // Open/minimise motion is the "windows & dialogs" animation preference.
        prefs.animWindows &&
          "transition-[opacity,transform] duration-200 animate-in fade-in-0 slide-in-from-bottom-4",
        floating ? "max-w-[calc(100vw-24px)] rounded-xl" : "inset-0 h-full w-full rounded-none",
        // Minimising animates the window down to the taskbar instead of just
        // vanishing; kept mounted (pointer-events-none) so clicks pass through.
        minimized && "pointer-events-none translate-y-10 scale-95 opacity-0",
        // Peek: stay translucent so you can read what's behind it. (No hover
        // bump back to full — that made the toggle look like it did nothing
        // while the cursor sat on the window.)
        peek && !minimized && "opacity-40",
      )}
      aria-hidden={minimized}
      style={style}
      onPointerDown={onFocus}
    >
      <div
        className={cn(
          "flex select-none items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2",
          draggable && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={startDrag}
      >
        <span className="truncate text-sm font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPeek((p) => !p)}
            aria-label={peek ? "Unpeek" : "Peek (make translucent)"}
            title="Peek — make the window translucent to see behind it"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {peek ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          {!isMobile && (
            <button
              type="button"
              onClick={() => setMaximized((m) => !m)}
              aria-label={maximized ? "Restore" : "Maximize"}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={onMinimize}
            aria-label="Minimize"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto p-4", floating && !size.current.h && "max-h-[75vh]")}>
        {children}
      </div>

      {draggable && (
        <div
          onPointerDown={startResize}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          aria-label="Resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 0 50%, hsl(var(--border)) 50% 60%, transparent 60% 70%, hsl(var(--border)) 70% 80%, transparent 80%)",
          }}
        />
      )}
    </div>
  );
}
