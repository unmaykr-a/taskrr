import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// useFlip animates layout changes of a container's keyed children (the FLIP
// technique: First, Last, Invert, Play). Children opt in with a
// `data-flip-key` attribute. After every render we compare each child's
// position (relative to the container, so scrolling can't fake a move) with
// where it was last time:
//   - moved   -> play a transform from the old position to the new one, so
//                reorders (quick log, filter change) glide instead of jumping;
//   - new     -> fade/rise it in, lightly staggered, so appearing cards feel
//                placed rather than popped.
// Uses the Web Animations API, which CSS rules can't disable — so the
// animations preference and the OS reduced-motion setting are checked here.
const MOVE_MS = 280;
const ENTER_MS = 240;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function motionDisabled(): boolean {
  return (
    document.documentElement.classList.contains("no-animations") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useFlip(ref: RefObject<HTMLElement | null>, enabled = true) {
  // Last known position of each key, relative to the container.
  const positions = useRef(new Map<string, { x: number; y: number }>());

  // A window resize reflows the grid without a React render; re-measure so the
  // next render doesn't read the reflow as a move and replay a spurious glide.
  useEffect(() => {
    const remeasure = () => {
      const container = ref.current;
      if (!container) return;
      const base = container.getBoundingClientRect();
      const next = new Map<string, { x: number; y: number }>();
      container.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((child) => {
        const key = child.dataset.flipKey;
        if (!key) return;
        const rect = child.getBoundingClientRect();
        next.set(key, { x: rect.left - base.left, y: rect.top - base.top });
      });
      positions.current = next;
    };
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [ref]);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) {
      positions.current = new Map();
      return;
    }
    const base = container.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    const children = container.querySelectorAll<HTMLElement>("[data-flip-key]");
    const skip = !enabled || motionDisabled();
    let enterIndex = 0;

    children.forEach((child) => {
      const key = child.dataset.flipKey;
      if (!key) return;
      const rect = child.getBoundingClientRect();
      const pos = { x: rect.left - base.left, y: rect.top - base.top };
      next.set(key, pos);
      if (skip) return;

      const prev = positions.current.get(key);
      if (prev) {
        const dx = prev.x - pos.x;
        const dy = prev.y - pos.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          child.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration: MOVE_MS, easing: EASE },
          );
        }
      } else {
        // Newly visible: fade/rise in, staggered a touch (capped so a large
        // grid doesn't take ages to settle).
        child.animate(
          [
            { opacity: 0, transform: "translateY(10px) scale(0.98)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: ENTER_MS,
            easing: EASE,
            delay: Math.min(enterIndex, 8) * 25,
            fill: "backwards",
          },
        );
        enterIndex += 1;
      }
    });

    positions.current = next;
  });
}
