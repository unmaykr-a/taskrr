import { useEffect, useRef } from "react";

import { useTheme } from "@/components/ThemeProvider";
import { usePrefs } from "@/lib/prefs";

/**
 * Background renders the theme's animated effect on a single full-screen canvas
 * behind the app. It's deliberately cheap: it pauses when the tab is hidden and
 * falls back to a static field when the user prefers reduced motion. "none"
 * renders nothing at all (just the solid page colour).
 *
 * The accent colour is read straight from the active theme (not the computed
 * CSS variable) so the effect recolours the instant you change it and never
 * races the ThemeProvider's applyTheme(). The canvas keeps animating while
 * floating windows / dialogs are open so live theme previews are visible.
 */
export function Background() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { prefs } = usePrefs();
  const { animations, animationSpeed, pauseBgOnDrag } = prefs;

  const { background: effect, intensity, size } = theme;
  // The effect draws in the theme's custom background colour when one is set,
  // otherwise it follows the accent. Overall prominence (bgOpacity) is applied
  // as CSS opacity on the canvas element — free on the GPU, works for every
  // effect, and changing it doesn't restart the animation.
  const accent = theme.bgColor || theme.colors.accent;
  const bgOpacity = theme.bgOpacity ?? 1;

  useEffect(() => {
    if (effect === "none") return;
    const speed = animationSpeed;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || !animations;

    let w = 0;
    let h = 0;
    type Pt = { x: number; y: number; z: number; tw: number; vx: number; vy: number };
    let pts: Pt[] = [];

    // Per-effect particle budget, scaled by the user's intensity.
    const counts: Record<string, number> = {
      aurora: 6,
      constellations: 80,
      synapse: 70,
      rain: 140,
      dots: 110,
      petals: 40,
      sparkles: 80,
      embers: 90,
      perlin: 70,
      fireflies: 22,
      comets: 42,
    };
    const baseCount = counts[effect] ?? 150;
    const count = Math.max(4, Math.round(baseCount * (0.4 + intensity)));
    const sizeBase = 0.6 + size * 2.4;

    function seed() {
      pts = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random(),
        tw: Math.random() * Math.PI * 2,
        vx: (Math.random() - 0.5) * 0.12 * dpr,
        vy: (Math.random() - 0.5) * 0.12 * dpr,
      }));
    }

    function resize() {
      const newW = Math.floor(window.innerWidth * dpr);
      // Only the width truly changing should reseed. Mobile browsers fire
      // `resize` constantly while scrolling because the URL bar grows/shrinks
      // the viewport *height* — reseeding on that regenerates the whole field
      // under the user's finger, which looks broken. Width-only guard fixes it.
      const widthChanged = newW !== w;
      w = canvas!.width = newW;
      h = canvas!.height = Math.floor(window.innerHeight * dpr);
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      if (widthChanged || pts.length === 0) seed();
    }

    function move(p: Pt) {
      if (reduce) return;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x += w;
      if (p.x > w) p.x -= w;
      if (p.y < 0) p.y += h;
      if (p.y > h) p.y -= h;
    }

    // dim < 1 quiets the field when stars are a backdrop (see comets).
    function stars(t: number, dim = 1) {
      ctx!.clearRect(0, 0, w, h);
      for (const p of pts) {
        const r = sizeBase * (0.4 + p.z) * dpr;
        const tw = reduce ? 0.8 : 0.5 + 0.5 * Math.sin(t / 700 + p.tw);
        ctx!.globalAlpha = (0.25 + 0.6 * p.z) * tw * (0.4 + 0.6 * intensity) * dim;
        ctx!.fillStyle = p.z > 0.85 ? accent : "#ffffff";
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx!.fill();
        move(p);
      }
      ctx!.globalAlpha = 1;
    }

    // A calm, evenly-lit field of accent dots (no twinkle), drifting slowly.
    function dots(_t: number) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = accent;
      for (const p of pts) {
        const r = sizeBase * (0.35 + p.z * 0.7) * dpr;
        ctx!.globalAlpha = (0.18 + 0.4 * p.z) * (0.4 + 0.6 * intensity);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx!.fill();
        move(p);
      }
      ctx!.globalAlpha = 1;
    }

    // Linked nodes — a network/graph look. `dense` widens the link radius and
    // pulses the line opacity for the brighter "synapse" variant.
    function network(t: number, dense: boolean) {
      stars(t);
      const maxd = (dense ? 150 : 120) * dpr * (0.6 + size);
      const pulse = dense ? 0.6 + 0.4 * Math.sin(t / 900) : 1;
      ctx!.lineWidth = dpr * 0.6;
      ctx!.strokeStyle = accent;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < maxd) {
            ctx!.globalAlpha = (1 - d / maxd) * 0.22 * pulse * (0.4 + 0.6 * intensity);
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }
      ctx!.globalAlpha = 1;
    }

    function aurora(t: number) {
      ctx!.clearRect(0, 0, w, h);
      for (const p of pts) {
        const cx = (p.x + (reduce ? 0 : Math.sin(t / 4000 + p.tw) * 80 * dpr)) % w;
        const cy = (p.y + (reduce ? 0 : Math.cos(t / 5200 + p.tw) * 60 * dpr)) % h;
        const rad = (160 + size * 240) * dpr * (0.6 + p.z);
        const grad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, "transparent");
        ctx!.globalAlpha = 0.06 + 0.1 * intensity;
        ctx!.fillStyle = grad;
        ctx!.fillRect(0, 0, w, h);
      }
      ctx!.globalAlpha = 1;
    }

    // Layered organic ribbons. Each line is the sum of two sine octaves whose
    // phases travel in *opposite* directions at different speeds, so the shape
    // genuinely morphs — crests grow, split, and dissolve — instead of a rigid
    // curve scrolling sideways (the old look). Lines also breathe vertically
    // and differ in amplitude/thickness/opacity so the stack reads as depth.
    function waves(t: number) {
      ctx!.clearRect(0, 0, w, h);
      const lines = Math.max(3, Math.round(3 + intensity * 7));
      ctx!.strokeStyle = accent;
      ctx!.lineCap = "round";
      const motion = reduce ? 0.3 : 1;
      for (let i = 0; i < lines; i++) {
        const depth = (i + 1) / lines; // 0..1, deeper lines are calmer/dimmer
        const drift = Math.sin(t / 9000 + i * 1.7) * h * 0.025 * motion;
        const yBase = (h / (lines + 1)) * (i + 1) + drift;
        const amp1 = (10 + size * 52) * dpr * (0.55 + 0.45 * Math.sin(i * 2.3 + t / 12000));
        const amp2 = amp1 * 0.45;
        const k1 = 1 / ((150 + i * 22) * dpr);
        const k2 = 1 / ((61 + i * 9) * dpr);
        const p1 = t / 2600 + i * 1.3;
        const p2 = -t / 4200 + i * 2.1; // opposite direction = morphing, not scrolling
        ctx!.lineWidth = dpr * (0.8 + 1.1 * (1 - depth));
        ctx!.beginPath();
        for (let x = 0; x <= w; x += 10 * dpr) {
          const y =
            yBase +
            (Math.sin(x * k1 + p1) * amp1 + Math.sin(x * k2 + p2) * amp2) * motion;
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.globalAlpha = (0.08 + 0.14 * intensity) * (1.2 - 0.7 * depth);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
    }

    function rain(_t: number) {
      ctx!.clearRect(0, 0, w, h);
      const len = (10 + size * 26) * dpr;
      const speed2 = (4 + size * 6) * dpr;
      ctx!.lineWidth = dpr;
      ctx!.strokeStyle = accent;
      for (const p of pts) {
        ctx!.globalAlpha = (0.15 + 0.5 * p.z) * (0.4 + 0.6 * intensity);
        ctx!.beginPath();
        ctx!.moveTo(p.x, p.y);
        ctx!.lineTo(p.x, p.y + len * (0.5 + p.z));
        ctx!.stroke();
        if (!reduce) {
          p.y += speed2 * (0.4 + p.z);
          if (p.y > h) {
            p.y = -len;
            p.x = Math.random() * w;
          }
        }
      }
      ctx!.globalAlpha = 1;
    }

    // Drifting, rotating petals that settle downward with a gentle sway.
    function petals(t: number) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = accent;
      for (const p of pts) {
        const x = p.x + (reduce ? 0 : Math.sin(t / 1000 + p.tw) * 18 * dpr);
        const rx = (3 + p.z * 5) * dpr * (0.6 + size);
        const ry = rx * 0.45;
        ctx!.save();
        ctx!.translate(x, p.y);
        ctx!.rotate(t / 1400 + p.tw);
        ctx!.globalAlpha = (0.25 + 0.4 * p.z) * (0.4 + 0.6 * intensity);
        ctx!.beginPath();
        ctx!.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.restore();
        if (!reduce) {
          p.y += (0.4 + p.z) * dpr * (0.5 + size);
          if (p.y > h + 10) {
            p.y = -10;
            p.x = Math.random() * w;
          }
        }
      }
      ctx!.globalAlpha = 1;
    }

    // Twinkling 4-point sparkles.
    function sparkles(t: number) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineCap = "round";
      for (const p of pts) {
        const tw = reduce ? 0.7 : 0.5 + 0.5 * Math.sin(t / 300 + p.tw * 5);
        const s = (1 + p.z * 2.5) * dpr * (0.6 + size);
        ctx!.globalAlpha = (0.2 + 0.8 * p.z) * tw * (0.4 + 0.6 * intensity);
        ctx!.strokeStyle = p.z > 0.7 ? accent : "#ffffff";
        ctx!.lineWidth = dpr;
        ctx!.beginPath();
        ctx!.moveTo(p.x - s, p.y);
        ctx!.lineTo(p.x + s, p.y);
        ctx!.moveTo(p.x, p.y - s);
        ctx!.lineTo(p.x, p.y + s);
        ctx!.stroke();
        move(p);
      }
      ctx!.globalAlpha = 1;
    }

    // Warm motes rising like embers.
    function embers(t: number) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = accent;
      for (const p of pts) {
        const r = (1 + p.z * 2) * dpr * (0.6 + size);
        const x = p.x + (reduce ? 0 : Math.sin(t / 700 + p.tw) * 8 * dpr);
        ctx!.globalAlpha = (0.15 + 0.5 * p.z) * (0.4 + 0.6 * intensity);
        ctx!.beginPath();
        ctx!.arc(x, p.y, r, 0, Math.PI * 2);
        ctx!.fill();
        if (!reduce) {
          p.y -= (0.4 + p.z) * dpr * (0.5 + size);
          if (p.y < -5) {
            p.y = h + 5;
            p.x = Math.random() * w;
          }
        }
      }
      ctx!.globalAlpha = 1;
    }

    // A flow field rendered as long, swirling filaments. Each particle keeps a
    // bounded history of its recent positions and is drawn as one polyline, so
    // trails are long but clear themselves by construction as old points drop
    // off the tail. (The previous version faded the canvas with a low-alpha
    // destination-out erase instead — but 8-bit alpha rounds a tiny erase to
    // zero once pixels get faint, so trails plateaued into a permanent haze
    // that smudged the whole screen.) The field is a large-scale, slowly
    // evolving sum of sines, so filaments curl in wide arcs rather than
    // jittering. Size controls trail length + line weight.
    const flowAngle = (x: number, y: number, t: number) =>
      Math.PI *
      (Math.sin((x / dpr) * 0.0022 + t * 0.00006) +
        Math.cos((y / dpr) * 0.0026 - t * 0.00005) +
        Math.sin(((x + y) / dpr) * 0.0013 + t * 0.00004));

    function flowRespawn(p: Pt) {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
    }

    // Per-particle trail state: a flat [x0,y0,x1,y1,...] history plus a dying
    // flag. A particle whose head leaves the screen isn't removed outright —
    // that popped the whole filament out of existence at the edge. Instead it
    // stops growing and *drains*: points drop off the old end a few per frame,
    // so the line visibly retracts along its own path off the edge, and only
    // then respawns somewhere fresh.
    type Trail = { pts: number[]; dying: boolean };
    let trails: Trail[] = [];
    function perlin(t: number) {
      ctx!.clearRect(0, 0, w, h);
      if (trails.length !== pts.length) trails = pts.map(() => ({ pts: [], dying: false }));
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.strokeStyle = accent;
      ctx!.lineWidth = dpr * (0.5 + size * 0.9);
      const step = (0.9 + size * 1.1) * dpr;
      const maxLen = 2 * Math.round(24 + size * 200); // points kept per tail
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const trail = trails[i];
        if (!reduce) {
          if (!trail.dying) {
            const a = flowAngle(p.x, p.y, t);
            p.x += Math.cos(a) * step * (0.6 + p.z);
            p.y += Math.sin(a) * step * (0.6 + p.z);
            trail.pts.push(p.x, p.y);
            if (trail.pts.length > maxLen) trail.pts.splice(0, trail.pts.length - maxLen);
            // Start draining at the edge (plus a tiny trickle at random so the
            // evolving field can't strand everything in one corner forever).
            if (p.x < -8 || p.x > w + 8 || p.y < -8 || p.y > h + 8 || Math.random() < 0.0004) {
              trail.dying = true;
            }
          } else {
            trail.pts.splice(0, 4); // retract two path points per frame
            if (trail.pts.length < 4) {
              flowRespawn(p);
              trail.pts.length = 0;
              trail.dying = false;
            }
          }
        }
        if (trail.pts.length >= 4) {
          ctx!.globalAlpha = (0.08 + 0.3 * p.z) * (0.4 + 0.6 * intensity);
          ctx!.beginPath();
          ctx!.moveTo(trail.pts[0], trail.pts[1]);
          for (let j = 2; j < trail.pts.length; j += 2) ctx!.lineTo(trail.pts[j], trail.pts[j + 1]);
          ctx!.stroke();
        }
      }
      ctx!.globalAlpha = 1;
    }

    // Static variant for reduced motion: pre-roll the simulation in one go so
    // the single frame still shows the long streamlines, not stubble.
    function perlinStatic(t: number) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineCap = "round";
      ctx!.strokeStyle = accent;
      ctx!.lineWidth = dpr * (0.5 + size * 0.9);
      const step = (0.7 + size * 0.9) * dpr;
      for (const p of pts) {
        ctx!.globalAlpha = (0.05 + 0.16 * p.z) * (0.4 + 0.6 * intensity);
        ctx!.beginPath();
        ctx!.moveTo(p.x, p.y);
        let x = p.x;
        let y = p.y;
        const steps = Math.round(120 + size * 200); // match the animated trail length
        for (let i = 0; i < steps; i++) {
          const a = flowAngle(x, y, t);
          x += Math.cos(a) * step * (0.6 + p.z);
          y += Math.sin(a) * step * (0.6 + p.z);
          if (x < 0 || x > w || y < 0 || y > h) break;
          ctx!.lineTo(x, y);
        }
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
    }

    // Wandering glow-worms: soft radial glows that drift on gently curving
    // paths and pulse in and out of brightness.
    function fireflies(t: number) {
      ctx!.clearRect(0, 0, w, h);
      for (const p of pts) {
        const wander = Math.sin(t / 1600 + p.tw * 4) * 0.9;
        if (!reduce) {
          const heading = p.tw + t / 5000 + wander;
          p.x += Math.cos(heading) * (0.25 + p.z * 0.4) * dpr;
          p.y += Math.sin(heading) * (0.25 + p.z * 0.4) * dpr;
          if (p.x < -20) p.x = w + 20;
          if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20;
          if (p.y > h + 20) p.y = -20;
        }
        const pulse = reduce ? 0.7 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 900 + p.tw * 7));
        const r = (5 + p.z * 9) * dpr * (0.5 + size);
        const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, "transparent");
        ctx!.globalAlpha = (0.25 + 0.45 * p.z) * pulse * (0.4 + 0.6 * intensity);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx!.fill();
        // a tiny bright core
        ctx!.globalAlpha *= 0.9;
        ctx!.fillStyle = accent;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, dpr * (0.8 + p.z), 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    // A quiet star backdrop with occasional shooting streaks.
    type Comet = { x: number; y: number; vx: number; vy: number; life: number; max: number };
    const comets_: Comet[] = [];
    let cometCooldown = 15; // first streak appears almost immediately
    function spawnComet() {
      const fromLeft = Math.random() < 0.5;
      const angle = (fromLeft ? 0.15 : Math.PI - 0.15) + (Math.random() - 0.5) * 0.5;
      const v = (4 + Math.random() * 5) * dpr;
      comets_.push({
        x: fromLeft ? -40 * dpr : w + 40 * dpr,
        y: Math.random() * h * 0.55,
        vx: Math.cos(angle) * v, // the angle already points inward from either edge
        vy: Math.sin(angle) * v * 0.6 + 0.4 * dpr,
        life: 0,
        max: 90 + Math.random() * 80,
      });
    }
    function comets(t: number) {
      // The stars are a quiet backdrop here — the comets are the show, so keep
      // the field dim and the streaks frequent (intensity drives how many).
      stars(t, 0.5);
      if (!reduce) {
        cometCooldown -= 1;
        const maxActive = 2 + Math.round(intensity * 4);
        if (cometCooldown <= 0 && comets_.length < maxActive) {
          spawnComet();
          cometCooldown = 45 + Math.random() * 180; // a streak every ~1-4 seconds
        }
        const tail = (60 + size * 120) * dpr;
        for (let i = comets_.length - 1; i >= 0; i--) {
          const c = comets_[i];
          c.x += c.vx;
          c.y += c.vy;
          c.life += 1;
          const fade = Math.sin(Math.min(1, c.life / c.max) * Math.PI); // ease in+out
          const grad = ctx!.createLinearGradient(c.x, c.y, c.x - c.vx * (tail / 5), c.y - c.vy * (tail / 5));
          grad.addColorStop(0, accent);
          grad.addColorStop(1, "transparent");
          ctx!.globalAlpha = 0.7 * fade * (0.4 + 0.6 * intensity);
          ctx!.strokeStyle = grad;
          ctx!.lineWidth = dpr * 1.4;
          ctx!.lineCap = "round";
          ctx!.beginPath();
          ctx!.moveTo(c.x, c.y);
          ctx!.lineTo(c.x - c.vx * (tail / 5), c.y - c.vy * (tail / 5));
          ctx!.stroke();
          if (c.life > c.max || c.x < -tail || c.x > w + tail || c.y > h + tail) {
            comets_.splice(i, 1);
          }
        }
        ctx!.globalAlpha = 1;
      }
    }

    const renderers: Record<string, (t: number) => void> = {
      aurora,
      constellations: (t) => network(t, false),
      synapse: (t) => network(t, true),
      waves,
      rain,
      dots,
      petals,
      sparkles,
      embers,
      // The animated flow needs frame-to-frame accumulation; a single reduced-
      // motion frame would show stubble, so it pre-rolls full streamlines.
      perlin: reduce ? perlinStatic : perlin,
      fireflies,
      comets,
      stars,
    };
    const render = renderers[effect] ?? stars;

    let raf = 0;
    let running = true;
    function frame(t: number) {
      if (!running) return;
      render(t * speed);
      // Reduced-motion / animations off: draw a single static frame and stop.
      if (reduce) return;
      raf = requestAnimationFrame(frame);
    }

    // Pause when the tab is hidden (the standard rAF optimisation), and — with
    // frosted glass on — while a window is dragged/resized or anything is
    // scrolling. Frosted surfaces re-sample their backdrop blur whenever the
    // canvas underneath changes, so an animating canvas + a scrolling task list
    // means double the blur work every frame; freezing the canvas during the
    // scroll halves it and is what the reported "frosted scrolling lag" needs.
    // With no blur there's nothing to protect, so the effect keeps moving. We
    // otherwise keep animating under windows so live theme previews are visible.
    let scrolling = false;
    let scrollTimer = 0;
    function recompute() {
      const frosted = document.documentElement.classList.contains("frosted");
      const frostedBusy =
        frosted &&
        pauseBgOnDrag &&
        (document.body.classList.contains("win-dragging") || scrolling);
      const shouldRun = !document.hidden && !frostedBusy;
      if (shouldRun && !running && !reduce) {
        running = true;
        raf = requestAnimationFrame(frame);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    }
    function onScroll() {
      if (!scrolling) {
        scrolling = true;
        recompute();
      }
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrolling = false;
        recompute();
      }, 160);
    }

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", recompute);
    window.addEventListener("win-dragging-change", recompute);
    // capture: scrolls of inner containers (task list, windows) don't bubble.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    recompute();
    if (running) raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(scrollTimer);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", recompute);
      window.removeEventListener("win-dragging-change", recompute);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [effect, intensity, size, animations, animationSpeed, accent, pauseBgOnDrag]);

  if (effect === "none") return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      // Promote the canvas to its own compositor layer so layout/paint elsewhere
      // (e.g. the calendar day-list opening) can't drag down its frame rate.
      // bgOpacity is plain CSS opacity: composited on the GPU and tweakable
      // live without restarting the effect.
      style={{ transform: "translateZ(0)", willChange: "transform", opacity: bgOpacity }}
      aria-hidden
    />
  );
}
