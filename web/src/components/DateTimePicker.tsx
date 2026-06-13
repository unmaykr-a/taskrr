import { useState } from "react";

import { usePrefs } from "@/lib/prefs";
import { ClockPicker } from "@/components/ClockPicker";
import { DatePickerCalendar } from "@/components/ui/DatePickerCalendar";

// Date + time picker. By default both halves use Taskrr's own controls — a
// calendar for the date and an analog clock for the time — but each can fall
// back to the OS-native input via the Preferences -> Pickers toggles. 12- vs
// 24-hour display follows the Time & date preference.
//
// `value` is a Date (local time); `onChange` reports a new Date. Seconds are
// zeroed so logged times are clean.

const INPUT =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function DateTimePicker({
  value,
  onChange,
  max,
}: {
  value: Date;
  onChange: (next: Date) => void;
  max?: Date;
}) {
  const { prefs } = usePrefs();
  const hour12 = prefs.hour12;
  const [showClock, setShowClock] = useState(false);
  const [showCal, setShowCal] = useState(false);

  const hours = value.getHours();
  const minutes = value.getMinutes();

  function emitDate(dateStr: string) {
    const [y, mo, da] = dateStr.split("-").map(Number);
    const d = new Date(value);
    d.setFullYear(y, mo - 1, da);
    d.setSeconds(0, 0);
    onChange(d);
  }

  function emitTime(h: number, m: number) {
    const d = new Date(value);
    d.setHours(h);
    d.setMinutes(m);
    d.setSeconds(0, 0);
    onChange(d);
  }

  const displayHour = hour12 ? ((hours + 11) % 12) + 1 : hours;
  const isPM = hours >= 12;
  const timeLabel = hour12
    ? `${displayHour}:${pad(minutes)} ${isPM ? "PM" : "AM"}`
    : `${pad(hours)}:${pad(minutes)}`;
  const dateLabel = value.toLocaleDateString(undefined, { dateStyle: "medium" });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {prefs.datePicker ? (
          <button
            type="button"
            onClick={() => setShowCal((s) => !s)}
            className={`${INPUT} min-w-[140px] text-left`}
            aria-expanded={showCal}
          >
            {dateLabel}
          </button>
        ) : (
          <input
            type="date"
            aria-label="Date"
            className={INPUT}
            value={toDateInput(value)}
            max={max ? toDateInput(max) : undefined}
            onChange={(e) => e.target.value && emitDate(e.target.value)}
          />
        )}

        {prefs.timePicker ? (
          <button
            type="button"
            onClick={() => setShowClock((s) => !s)}
            className={`${INPUT} min-w-[92px] text-left tabular-nums`}
            aria-expanded={showClock}
          >
            {timeLabel}
          </button>
        ) : (
          <input
            type="time"
            aria-label="Time"
            className={INPUT}
            value={`${pad(hours)}:${pad(minutes)}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (!Number.isNaN(h) && !Number.isNaN(m)) emitTime(h, m);
            }}
          />
        )}
      </div>

      {prefs.datePicker && showCal && (
        <DatePickerCalendar
          value={value}
          max={max}
          onChange={(d) => {
            emitDate(toDateInput(d));
            setShowCal(false);
          }}
        />
      )}

      {prefs.timePicker && showClock && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <ClockPicker hours={hours} minutes={minutes} hour12={hour12} onChange={emitTime} />
        </div>
      )}
    </div>
  );
}
