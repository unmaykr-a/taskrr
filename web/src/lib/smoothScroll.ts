// smoothScroll — eased mouse-wheel scrolling, no dependencies.
//
// Why scrolling can feel rough even on a 300 Hz screen: a classic mouse wheel
// delivers discrete ~100 px jumps, and the browser applies each one in a single
// frame — the refresh rate never gets a chance to matter. This module
// intercepts those discrete wheel ticks and plays them out via
// requestAnimationFrame with a time-based exponential ease, so the scroll
// position is interpolated at whatever rate the display refreshes.
//
// Deliberately conservative about what it hijacks:
//   - touchpads and touchscreens keep native scrolling (their small,
//     high-frequency pixel deltas and momentum already feel right — and feel
//     worse when re-eased), detected via the delta-size heuristic below;
//   - ctrl+wheel (zoom) and shift/horizontal scrolling pass through;
//   - anything that already called preventDefault passes through.

/** Time constant of the ease (ms): position closes ~63% of the gap per tau. */
const TAU = 90;
/** Pixels per "line" for browsers that report wheel deltas in lines (Firefox). */
const LINE_PX = 16;
/** Pixel deltas below this are treated as touchpad input and left native. */
const TOUCHPAD_MAX_PX = 40;

// `written` is the scrollTop we last set ourselves, so the next frame can tell
// our own write apart from an external change (a scrollbar drag, anchor jump,
// etc.) and bow out instead of fighting it.
type ScrollState = { target: number; written?: number };

/** Walk up from `from` to the nearest element that can actually scroll further
 *  in the wheel's direction, falling back to the document scroller. */
function scrollableAncestor(from: Element | null, deltaY: number): HTMLElement | null {
  const canTake = (el: HTMLElement) =>
    deltaY > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
  for (let n = from; n; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1 && canTake(n)) {
      return n;
    }
  }
  const root = document.scrollingElement;
  if (
    root instanceof HTMLElement &&
    root.scrollHeight > root.clientHeight + 1 &&
    canTake(root)
  ) {
    return root;
  }
  return null;
}

// Whether an eased scroll is currently in flight. The animated background reads
// this so it can stay paused for the whole smooth scroll instead of flickering
// on the increasingly sparse scroll events the eased tail emits.
let animating = false;
function setAnimating(v: boolean) {
  if (animating === v) return;
  animating = v;
  window.dispatchEvent(new Event("taskrr-smoothscroll"));
}

/** True while a smooth-wheel animation is running. */
export function isSmoothScrolling(): boolean {
  return animating;
}

/** Install the wheel smoother. Returns an uninstall function. */
export function installSmoothWheel(): () => void {
  const states = new Map<HTMLElement, ScrollState>();
  let raf = 0;
  let last = 0;

  const tick = (now: number) => {
    raf = 0;
    const dt = Math.min(64, now - last); // clamp dt so a hidden tab doesn't warp
    last = now;
    const k = 1 - Math.exp(-dt / TAU);
    let active = false;
    states.forEach((s, el) => {
      // If the position moved by something other than our own last write — the
      // user grabbed the scrollbar, or the page jumped to an anchor — abandon
      // the animation so we don't yank it back ("stuck in place" jitter).
      if (s.written !== undefined && Math.abs(el.scrollTop - s.written) > 2) {
        states.delete(el);
        return;
      }
      const diff = s.target - el.scrollTop;
      // Snap home once within a pixel. Below ~1px the per-frame step is so small
      // that scrollTop's integer value changes only every few frames, so the
      // scroll events spread out — and anything that debounces "is scrolling"
      // (e.g. the background pausing on scroll) flickers off/on as the tail
      // decelerates. Ending here keeps the events dense and the finish crisp.
      if (Math.abs(diff) < 1) {
        el.scrollTop = s.target;
        states.delete(el);
        return;
      }
      const before = el.scrollTop;
      el.scrollTop += diff * k;
      // No movement this frame means the step was below the browser's scroll
      // granularity (some browsers round scrollTop to whole pixels), so easing
      // further would stall. Snap home and finish.
      if (el.scrollTop === before) {
        el.scrollTop = s.target;
        states.delete(el);
        return;
      }
      s.written = el.scrollTop;
      active = true;
    });
    if (active) raf = requestAnimationFrame(tick);
    else setAnimating(false);
  };

  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal intent
    const px = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY;
    // Small pixel deltas = touchpad; let the browser's native feel handle it.
    if (e.deltaMode === 0 && Math.abs(px) < TOUCHPAD_MAX_PX) return;

    const el = scrollableAncestor(e.target as Element, px);
    if (!el) return;
    e.preventDefault();

    // Resume an in-flight animation, but if the element was moved externally
    // since our last write (e.g. a scrollbar drag), start fresh from where it
    // actually sits rather than from the stale target.
    const prev = states.get(el);
    const s =
      prev && (prev.written === undefined || Math.abs(el.scrollTop - prev.written) <= 2)
        ? prev
        : { target: el.scrollTop };
    const max = el.scrollHeight - el.clientHeight;
    s.target = Math.max(0, Math.min(max, s.target + px));
    states.set(el, s);
    setAnimating(true);
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  window.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    window.removeEventListener("wheel", onWheel);
    if (raf) cancelAnimationFrame(raf);
    states.clear();
    setAnimating(false);
  };
}
