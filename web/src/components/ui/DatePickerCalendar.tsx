import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
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

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Previous month"
            onClick={() => setView(new Date(year, month - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Next month"
            onClick={() => setView(new Date(year, month + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
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
    </div>
  );
}
