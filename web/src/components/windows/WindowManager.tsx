import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { ChevronsDown, ChevronsUp, Square, X, XSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { usePrefs, type WindowSize } from "@/lib/prefs";
import { FloatingWindow } from "@/components/windows/FloatingWindow";

const SIDEBAR_WIDTH = 240; // w-60

export interface WindowDef {
  id: string;
  title: string;
  content: ReactNode;
  /** Optional initial width in px (defaults to the standard panel width). */
  width?: number;
}

interface WindowManagerCtx {
  open: (win: WindowDef) => void;
  close: (id: string) => void;
  closeAll: () => void;
  toggle: (win: WindowDef) => void;
  isOpen: (id: string) => boolean;
}

const Ctx = createContext<WindowManagerCtx | null>(null);

export function useWindows() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWindows must be used within a WindowManagerProvider");
  return c;
}

/**
 * WindowManagerProvider owns the set of open floating windows, their stacking
 * order, and which are minimised. Opening a window that's already open brings it
 * to the front (so panels like Theme are singletons), while different windows —
 * e.g. several task panels — coexist. Minimised windows collapse to the taskbar
 * at the bottom of the screen, which doubles as a tab strip for switching
 * between everything that's open.
 */
export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const { prefs, setPrefs } = usePrefs();
  const [windows, setWindows] = useState<WindowDef[]>([]);
  const [order, setOrder] = useState<string[]>([]); // last id == top-most
  const [minimized, setMinimized] = useState<string[]>([]);

  // Remember a window's size (per id) so it reopens the way you left it.
  const rememberSize = useCallback(
    (id: string, size: WindowSize) =>
      setPrefs({ windowSizes: { ...prefs.windowSizes, [id]: size } }),
    [prefs.windowSizes, setPrefs],
  );

  const focus = useCallback((id: string) => {
    setOrder((o) => [...o.filter((x) => x !== id), id]);
    setMinimized((m) => m.filter((x) => x !== id));
  }, []);

  const open = useCallback((win: WindowDef) => {
    setWindows((prev) =>
      prev.some((p) => p.id === win.id) ? prev.map((p) => (p.id === win.id ? win : p)) : [...prev, win],
    );
    setOrder((o) => [...o.filter((x) => x !== win.id), win.id]);
    setMinimized((m) => m.filter((x) => x !== win.id));
  }, []);

  const close = useCallback((id: string) => {
    setWindows((prev) => prev.filter((p) => p.id !== id));
    setOrder((o) => o.filter((x) => x !== id));
    setMinimized((m) => m.filter((x) => x !== id));
  }, []);

  const minimize = useCallback((id: string) => {
    setMinimized((m) => (m.includes(id) ? m : [...m, id]));
  }, []);

  const minimizeAll = useCallback(() => setMinimized(windows.map((w) => w.id)), [windows]);
  const restoreAll = useCallback(() => setMinimized([]), []);
  const closeAll = useCallback(() => {
    setWindows([]);
    setOrder([]);
    setMinimized([]);
  }, []);

  const isOpen = useCallback((id: string) => windows.some((w) => w.id === id), [windows]);

  const toggle = useCallback(
    (win: WindowDef) => (windows.some((w) => w.id === win.id) ? close(win.id) : open(win)),
    [windows, open, close],
  );

  const value = useMemo<WindowManagerCtx>(
    () => ({ open, close, closeAll, toggle, isOpen }),
    [open, close, closeAll, toggle, isOpen],
  );

  const topId = order[order.length - 1];
  // When everything is already minimised, the bulk button flips to "bring all up".
  const allMinimized = windows.length > 0 && windows.every((w) => minimized.includes(w.id));

  // The taskbar starts at the static sidebar's edge (when it's showing), not the
  // screen edge. The sidebar is static only on wide, non-landscape-phone layouts.
  const wideEnough = useMediaQuery("(min-width: 768px)");
  const phoneLandscape = useMediaQuery("(orientation: landscape) and (max-height: 600px)");
  const taskbarLeft = wideEnough && !phoneLandscape ? SIDEBAR_WIDTH : 0;

  return (
    <Ctx.Provider value={value}>
      {children}
      {windows.map((w, i) => (
        <FloatingWindow
          key={w.id}
          title={w.title}
          index={i}
          width={w.width}
          savedSize={prefs.windowSizes?.[w.id]}
          onResizeEnd={(size) => rememberSize(w.id, size)}
          z={50 + order.indexOf(w.id)}
          minimized={minimized.includes(w.id)}
          onClose={() => close(w.id)}
          onMinimize={() => minimize(w.id)}
          onFocus={() => focus(w.id)}
        >
          {w.content}
        </FloatingWindow>
      ))}

      {/* Taskbar / tab strip for every open window. */}
      {windows.length > 0 && (
        <div
          className="fixed bottom-0 z-[45] flex flex-wrap gap-1 p-2"
          style={{ left: taskbarLeft, right: 0 }}
        >
          {/* Bulk controls: send everything to the taskbar / close everything. */}
          {windows.length > 1 && (
            <div className="flex items-center gap-1 rounded-md border bg-card/95 px-1 py-1 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={allMinimized ? restoreAll : minimizeAll}
                title={allMinimized ? "Bring all up" : "Minimise all"}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {allMinimized ? (
                  <ChevronsUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsDown className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={closeAll}
                title="Close all"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <XSquare className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {windows.map((w) => {
            const isMin = minimized.includes(w.id);
            const isTop = w.id === topId && !isMin;
            return (
              <div
                key={w.id}
                className={cn(
                  "flex items-center gap-1 rounded-md border bg-card/95 pl-2 pr-1 py-1 text-xs shadow-lg backdrop-blur",
                  isTop ? "border-primary/60 text-foreground" : "text-muted-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => focus(w.id)}
                  className="flex items-center gap-1.5 hover:text-foreground"
                  title={isMin ? "Restore" : "Bring to front"}
                >
                  <Square className={cn("h-3 w-3", isTop && "fill-primary text-primary")} />
                  <span className="max-w-[40vw] truncate sm:max-w-[180px]">{w.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => close(w.id)}
                  aria-label={`Close ${w.title}`}
                  className="rounded p-0.5 hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Ctx.Provider>
  );
}
