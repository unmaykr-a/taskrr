import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABELS = Array.from({ length: 12 }, (_, m) =>
  new Date(2000, m, 1).toLocaleDateString(undefined, { month: "short" }),
);
const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * DatePickerCalendar is a compact month grid for choosing a single date — the
 * same look as the app's main Calendar, used by DateTimePicker when the custom
 * date picker preference is on. `value`/`onChange` are local Dates (time of day
 * untouched). `max` optionally caps selectable days (e.g. "no future").
 */
export function DatePickerCalendar({
  value,
  onChange,
  max,
}: {
  value: Date;
  onChange: (d: Date) => void;
  max?: Date;
}) {
  const [view, setView] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  // Month/year chooser: clicking the title swaps the day grid for it.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => value.getFullYear());

  const year = view.getFullYear();
  const month = view.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const selectedKey = key(value);
  const todayKey = key(new Date());
  const maxKey = max ? key(max) : null;

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const pick = (day: number) => {
    const d = new Date(value);
    d.setFullYear(year, month, day);
    onChange(d);
  };

  const gotoMonth = (y: number, m: number) => {
    setView(new Date(y, m, 1));
    setPickerOpen(false);
  };

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setPickerYear(year);
            setPickerOpen((o) => !o);
          }}
          aria-expanded={pickerOpen}
          title="Pick a month and year"
          className="group flex items-center gap-1 rounded text-sm font-semibold transition-colors hover:text-primary"
        >
          {view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-hover:text-primary",
              pickerOpen && "rotate-180",
            )}
          />
        </button>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Previous month"
            onClick={() => { setPickerOpen(false); setView(new Date(year, month - 1, 1)); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Next month"
            onClick={() => { setPickerOpen(false); setView(new Date(year, month + 1, 1)); }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {pickerOpen ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Previous year"
              onClick={() => setPickerYear((y) => y - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">{pickerYear}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Next year"
              onClick={() => setPickerYear((y) => y + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, m) => {
              const now = new Date();
              const isViewed = pickerYear === year && m === month;
              const isThisMonth = pickerYear === now.getFullYear() && m === now.getMonth();
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => gotoMonth(pickerYear, m)}
                  className={cn(
                    "rounded-md py-2 text-xs transition-colors",
                    isViewed
                      ? "bg-primary/15 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    isThisMonth && !isViewed && "ring-1 ring-primary/40",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
      <>
      <div className="grid select-none grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid select-none grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const cellKey = key(new Date(year, month, day));
          const disabled = maxKey != null && cellKey > maxKey;
          const isToday = cellKey === todayKey;
          const isSelected = cellKey === selectedKey;
          return (
            <button
              key={cellKey}
              type="button"
              disabled={disabled}
              onClick={() => pick(day)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-xs transition-colors",
                isSelected
                  ? "bg-primary font-medium text-primary-foreground"
                  : "hover:bg-accent",
                isToday && !isSelected && "ring-1 ring-primary",
                disabled && "cursor-not-allowed opacity-30 hover:bg-transparent",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
