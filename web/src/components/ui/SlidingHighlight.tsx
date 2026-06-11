import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

/**
 * SlidingHighlight renders the "bubble" behind the selected item of a group
 * (sidebar views, settings nav, calendar day, login/register tabs). Instead of
 * each item painting its own active background, one absolutely-positioned span
 * glides to whichever item is active — so switching slides the highlight over.
 *
 * Usage: give the container `position: relative` and pass its ref; mark each
 * item with `data-slide-key` and make it `position: relative` so its content
 * paints above the bubble. Pass the active key and the bubble's colour classes.
 *
 * The first placement (mount / nothing-to-something) applies without a
 * transition so the bubble doesn't fly in from the corner; only moves between
 * items animate. Re-measures when the container resizes (window resize, the
 * settings window being dragged wider, nav switching orientation).
 */
export function SlidingHighlight({
  containerRef,
  activeKey,
  className,
}: {
  containerRef: RefObject<HTMLElement | null>;
  activeKey: string | null;
  className?: string;
}) {
  const { prefs } = usePrefs();
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const [settled, setSettled] = useState(false); // true once the first position landed

  // Re-run measurement on activeKey changes and container resizes. The version
  // counter lets the ResizeObserver invalidate the layout effect.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setVersion((v) => v + 1));
    ro.observe(c);
    return () => ro.disconnect();
  }, [containerRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const el =
      activeKey != null && container
        ? container.querySelector<HTMLElement>(`[data-slide-key="${CSS.escape(activeKey)}"]`)
        : null;
    if (!el) {
      setStyle(null);
      setSettled(false);
      return;
    }
    setStyle({
      transform: `translate(${el.offsetLeft}px, ${el.offsetTop}px)`,
      width: el.offsetWidth,
      height: el.offsetHeight,
    });
    // Enable the transition only after the first position has been painted.
    if (!settled) {
      const raf = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [activeKey, containerRef, version, settled]);

  if (!style) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0",
        settled && prefs.animIndicators
          ? "transition-[transform,width,height] duration-300 ease-out"
          : "transition-none",
        className,
      )}
      style={style}
    />
  );
}
