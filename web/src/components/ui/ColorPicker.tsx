import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getRecentColors, hexToHsv, hsvToHex, isHex, pushRecentColor, type HSV } from "@/lib/color";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const SWATCHES = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#ffffff", "#a1a1aa",
  "#52525b", "#0a0a0b",
];

/** Drag handler shared by the SV square and the hue strip. */
function useDrag(onMove: (e: PointerEvent, rect: DOMRect) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onMove(e.nativeEvent, rect);
    const move = (ev: PointerEvent) => onMove(ev, rect);
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  return { ref, start };
}

/**
 * ColorPicker is a compact, dependency-free HSV picker: a saturation/value
 * square, a hue strip, a hex field, and a swatch palette. Hue is kept in local
 * state so it survives passing through pure black/white (where it's undefined).
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const [recent, setRecent] = useState<string[]>(getRecentColors);
  const record = (hex: string) => setRecent(pushRecentColor(hex));

  // Resync when the value changes from outside (preset, default, etc.).
  useEffect(() => {
    if (hsvToHex(hsv.h, hsv.s, hsv.v).toLowerCase() !== value.toLowerCase()) {
      setHsv(hexToHsv(value));
      setHexText(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (next: HSV) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    setHexText(hex);
    onChange(hex);
  };

  const sv = useDrag((e, rect) => {
    const s = (e.clientX - rect.left) / rect.width;
    const v = 1 - (e.clientY - rect.top) / rect.height;
    emit({ h: hsv.h, s: Math.min(1, Math.max(0, s)), v: Math.min(1, Math.max(0, v)) });
  });
  const hue = useDrag((e, rect) => {
    const h = ((e.clientX - rect.left) / rect.width) * 360;
    emit({ ...hsv, h: Math.min(359.99, Math.max(0, h)) });
  });

  const hueHex = hsvToHex(hsv.h, 1, 1);

  return (
    <div className="w-56 space-y-2">
      {/* Saturation / value square */}
      <div
        ref={sv.ref}
        onPointerDown={sv.start}
        className="relative h-32 w-full cursor-crosshair touch-none rounded-md"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }}
        />
      </div>

      {/* Hue strip */}
      <div
        ref={hue.ref}
        onPointerDown={hue.start}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full"
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>

      {/* Hex field + current swatch */}
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 shrink-0 rounded border" style={{ backgroundColor: value }} />
        <input
          value={hexText}
          onChange={(e) => {
            const t = e.target.value;
            setHexText(t);
            if (isHex(t)) {
              const full = t.length === 4 ? `#${t.slice(1).split("").map((c) => c + c).join("")}` : t;
              emit(hexToHsv(full));
              record(full);
            }
          }}
          spellCheck={false}
          className="h-7 w-full rounded border border-input bg-transparent px-2 font-mono text-xs uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* Suggestions */}
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Suggestions</p>
        <div className="grid grid-cols-10 gap-1">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                emit(hexToHsv(c));
                record(c);
              }}
              className={cn(
                "h-4 w-4 rounded-sm border border-black/20",
                value.toLowerCase() === c.toLowerCase() && "ring-2 ring-primary ring-offset-1 ring-offset-card",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Recent */}
      {recent.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recent</p>
          <div className="grid grid-cols-10 gap-1">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  emit(hexToHsv(c));
                  record(c);
                }}
                className="h-4 w-4 rounded-sm border border-black/20"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ColorField is the labelled control used throughout the app. It honours the
 * per-person `colorPicker` preference: "native" renders the OS colour input,
 * "wheel" renders a swatch button that opens the built-in ColorPicker in a small
 * popover. An optional onClear shows a "Default" button (for per-task overrides).
 */
export function ColorField({
  label,
  value,
  onChange,
  onClear,
  isDefault,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  onClear?: () => void;
  isDefault?: boolean;
}) {
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const POP_W = 248; // ColorPicker (w-56) + p-3

  const openPicker = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(Math.max(8, r.right - POP_W), window.innerWidth - POP_W - 8);
      const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 340));
      setCoords({ top, left });
    }
    setOpen(true);
  };

  if (prefs.colorPicker === "native") {
    return (
      <label className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1.5">
          {onClear && isDefault && <span className="text-[10px] text-muted-foreground">default</span>}
          <input
            type="color"
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          {onClear && !isDefault && (
            <button type="button" onClick={onClear} className="text-[10px] text-muted-foreground hover:text-foreground">
              reset
            </button>
          )}
        </span>
      </label>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm hover:bg-accent"
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1.5">
          {onClear && isDefault && <span className="text-[10px] text-muted-foreground">default</span>}
          <span className="h-5 w-7 rounded border border-black/20" style={{ backgroundColor: value }} />
        </span>
      </button>
      {/* Portaled to <body> + fixed-positioned so a window's overflow can't clip
          it, with a solid popover background. */}
      {open &&
        coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[201] rounded-lg border bg-popover p-3 shadow-2xl"
              style={{ top: coords.top, left: coords.left, width: POP_W }}
            >
              <ColorPicker value={value} onChange={onChange} />
              {onClear && (
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                  className="mt-2 w-full rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Use app default
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
