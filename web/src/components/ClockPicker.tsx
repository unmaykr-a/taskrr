import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

// ClockPicker — an analog clock face for choosing a time, replacing the old
// hour/minute dropdowns. Tap or drag on the dial. It works in two steps (hour,
// then minute) like the familiar mobile time pickers. In 24-hour mode the hours
// use two rings (outer 12–23, inner 00–11); in 12-hour mode it's a single ring
// plus an AM/PM toggle. Pure presentational state in `mode`; the chosen time is
// reported back as {hours 0..23, minutes 0..59}.

const SIZE = 232;
const CENTER = SIZE / 2;
const OUTER_R = 96; // outer hour ring / minute ring
const INNER_R = 62; // inner hour ring (24h)

type Mode = "hour" | "minute";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Angle (deg, 0 at 12 o'clock, clockwise) + radius for a pointer event. */
function polar(e: { clientX: number; clientY: number }, rect: DOMRect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  let a = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (a < 0) a += 360;
  const r = (Math.hypot(dx, dy) * OUTER_R) / (rect.width / 2);
  return { angle: a, r };
}

export function ClockPicker({
  hours,
  minutes,
  hour12,
  onChange,
}: {
  hours: number; // 0..23
  minutes: number; // 0..59
  hour12: boolean;
  onChange: (h: number, m: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("hour");
  const faceRef = useRef<HTMLDivElement>(null);
  const isPM = hours >= 12;

  const setFromPointer = (e: { clientX: number; clientY: number }) => {
    const el = faceRef.current;
    if (!el) return;
    const { angle, r } = polar(e, el.getBoundingClientRect());
    if (mode === "hour") {
      const idx = Math.round(angle / 30) % 12; // 0 at top
      if (hour12) {
        const base = idx === 0 ? 12 : idx; // 12,1..11
        // Dial position to 24h: 12 AM is 0 and 12 PM is 12 (the "12" position
        // doesn't shift with PM); 1-11 stay as-is for AM and shift +12 for PM.
        const h = base === 12 ? (isPM ? 12 : 0) : isPM ? base + 12 : base;
        onChange(h, minutes);
      } else {
        const outer = r > (OUTER_R + INNER_R) / 2;
        const h = outer ? (idx === 0 ? 12 : 12 + idx) : idx; // outer 12..23, inner 0..11
        onChange(h, minutes);
      }
    } else {
      const m = Math.round(angle / 6) % 60;
      onChange(hours, m);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    setFromPointer(e);
    const move = (ev: PointerEvent) => setFromPointer(ev);
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if (mode === "hour") setMode("minute"); // advance to minutes after picking the hour
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  // The hand angle + which ring the selected hour sits on.
  const displayHour12 = ((hours + 11) % 12) + 1;
  const handAngle =
    mode === "hour" ? (hour12 ? (displayHour12 % 12) * 30 : (hours % 12) * 30) : minutes * 6;
  const handLen = mode === "hour" && !hour12 && hours < 12 ? INNER_R : OUTER_R;
  const handRad = ((handAngle - 90) * Math.PI) / 180;
  const handX = CENTER + Math.cos(handRad) * handLen;
  const handY = CENTER + Math.sin(handRad) * handLen;

  const ticks: { label: string; value: number; ring: "outer" | "inner" }[] =
    mode === "hour"
      ? hour12
        ? Array.from({ length: 12 }, (_, i) => ({ label: i === 0 ? "12" : String(i), value: i, ring: "outer" }))
        : [
            ...Array.from({ length: 12 }, (_, i) => ({
              label: i === 0 ? "12" : String(12 + i),
              value: i,
              ring: "outer" as const,
            })),
            ...Array.from({ length: 12 }, (_, i) => ({ label: pad(i), value: i, ring: "inner" as const })),
          ]
      : Array.from({ length: 12 }, (_, i) => ({ label: pad(i * 5), value: i * 5, ring: "outer" }));

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Digital read-out + mode switch */}
      <div className="flex items-center gap-1 text-2xl font-semibold tabular-nums">
        <button
          type="button"
          onClick={() => setMode("hour")}
          className={cn("rounded px-1", mode === "hour" ? "text-primary" : "text-muted-foreground")}
        >
          {hour12 ? displayHour12 : pad(hours)}
        </button>
        <span>:</span>
        <button
          type="button"
          onClick={() => setMode("minute")}
          className={cn("rounded px-1", mode === "minute" ? "text-primary" : "text-muted-foreground")}
        >
          {pad(minutes)}
        </button>
        {hour12 && (
          <div className="ml-2 flex flex-col text-xs">
            <button
              type="button"
              onClick={() => onChange(hours % 12, minutes)}
              className={cn("rounded px-1", !isPM ? "bg-primary/15 text-primary" : "text-muted-foreground")}
            >
              AM
            </button>
            <button
              type="button"
              onClick={() => onChange((hours % 12) + 12, minutes)}
              className={cn("rounded px-1", isPM ? "bg-primary/15 text-primary" : "text-muted-foreground")}
            >
              PM
            </button>
          </div>
        )}
      </div>

      {/* Dial */}
      <div
        ref={faceRef}
        onPointerDown={startDrag}
        className="relative touch-none select-none rounded-full bg-muted/50"
        style={{ width: SIZE, height: SIZE }}
      >
        {/* hand */}
        <svg className="pointer-events-none absolute inset-0" width={SIZE} height={SIZE}>
          <line x1={CENTER} y1={CENTER} x2={handX} y2={handY} stroke="hsl(var(--primary))" strokeWidth={2} />
          <circle cx={CENTER} cy={CENTER} r={3} fill="hsl(var(--primary))" />
          <circle cx={handX} cy={handY} r={16} fill="hsl(var(--primary))" fillOpacity={0.25} />
        </svg>
        {ticks.map((t, i) => {
          const radius = t.ring === "inner" ? INNER_R : OUTER_R;
          const a = ((t.value * (mode === "minute" ? 6 : 30) - 90) * Math.PI) / 180;
          const x = CENTER + Math.cos(a) * radius;
          const y = CENTER + Math.sin(a) * radius;
          const selected =
            mode === "hour"
              ? hour12
                ? (displayHour12 % 12) === t.value && t.ring === "outer"
                : hours === (t.ring === "outer" ? (t.value === 0 ? 12 : 12 + t.value) : t.value)
              : minutes === t.value;
          return (
            <span
              key={`${t.ring}-${i}`}
              className={cn(
                "pointer-events-none absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs tabular-nums",
                selected ? "font-semibold text-primary-foreground" : "text-foreground",
                t.ring === "inner" && !selected && "text-muted-foreground",
              )}
              style={{ left: x, top: y }}
            >
              {t.label}
            </span>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "hour" ? "Pick the hour" : "Pick the minute"}
      </p>
    </div>
  );
}
