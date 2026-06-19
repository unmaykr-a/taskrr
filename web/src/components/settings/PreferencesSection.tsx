import {
  type AddButtonPosition,
  type CardSize,
  type ClockChoice,
  type DateOrder,
  usePrefs,
} from "@/lib/prefs";
import { Segmented } from "@/components/ui/Segmented";
import { ColorField } from "@/components/ui/ColorPicker";
import { Label } from "@/components/ui/label";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Per-user preferences that aren't strictly "theme": clock, task colours,
 *  layout density, panels, and motion. */
export function PreferencesSection() {
  const { prefs, setPrefs } = usePrefs();

  return (
    <div className="space-y-5">
      {/* Time & date */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Time &amp; date</h3>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Clock</Label>
          <Segmented
            value={prefs.clock}
            onChange={(v: ClockChoice) => setPrefs({ clock: v })}
            options={[
              { value: "auto", label: "Auto", title: "Follow this device's system setting" },
              { value: "12", label: "12-hour" },
              { value: "24", label: "24-hour" },
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date format</Label>
          <Segmented
            value={prefs.dateFormat}
            onChange={(v: DateOrder) => setPrefs({ dateFormat: v })}
            options={[
              { value: "auto", label: "Auto", title: "Follow this device's system setting" },
              { value: "dmy", label: "13 Jun" },
              { value: "mdy", label: "Jun 13" },
              { value: "ymd", label: "2026-06-13" },
            ]}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Auto follows each device's own system settings.
        </p>
      </section>

      {/* Task staleness colours + gradient */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Task colours</h3>
        <p className="text-xs text-muted-foreground">
          Defaults for every task — each task can override these in its Manage window.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="Recent"
            value={prefs.taskColorFresh}
            onChange={(hex) => setPrefs({ taskColorFresh: hex })}
          />
          <ColorField
            label="Overdue"
            value={prefs.taskColorOverdue}
            onChange={(hex) => setPrefs({ taskColorOverdue: hex })}
          />
        </div>
        <div
          className="h-2 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${prefs.taskColorFresh}, ${prefs.taskColorOverdue})`,
          }}
        />
        <label className="flex items-center justify-between gap-2 pt-1 text-sm">
          <span className="text-muted-foreground">
            Fade colours over time
            <span className="block text-xs">
              Off keeps every task at its recent colour — no need for per-task freeze.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-primary"
            checked={prefs.colorFade}
            onChange={(e) => setPrefs({ colorFade: e.target.checked })}
          />
        </label>
        {prefs.colorFade && (
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              No-routine fade: {prefs.noRoutineFadeDays}d
            </Label>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={prefs.noRoutineFadeDays}
              onChange={(e) => setPrefs({ noRoutineFadeDays: Number(e.target.value) })}
              className="w-32 accent-primary"
              aria-label="Days for a routine-less task to fade to overdue"
            />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Add button (mobile)</Label>
          <select
            className={SELECT}
            value={prefs.addButton}
            onChange={(e) => setPrefs({ addButton: e.target.value as AddButtonPosition })}
          >
            <option value="top" className="bg-background">Top right</option>
            <option value="bottom" className="bg-background">Bottom (FAB)</option>
          </select>
        </div>
      </section>

      {/* Pickers: Taskrr's own controls on by default; turn one off for the
          device's native input. */}
      <details className="rounded-lg border">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">Pickers</summary>
        <div className="space-y-2.5 border-t p-3">
          <p className="text-[11px] text-muted-foreground">
            Taskrr's own pickers are on by default; turn one off to use your device's native control.
          </p>
          <AnimToggle
            label="Custom colour picker"
            hint="A colour wheel instead of the system picker"
            checked={prefs.colorPicker === "wheel"}
            onChange={(v) => setPrefs({ colorPicker: v ? "wheel" : "native" })}
          />
          <AnimToggle
            label="Custom date picker"
            hint="A calendar instead of the system date input"
            checked={prefs.datePicker}
            onChange={(v) => setPrefs({ datePicker: v })}
          />
          <AnimToggle
            label="Custom time picker"
            hint="An analog clock instead of the system time input"
            checked={prefs.timePicker}
            onChange={(v) => setPrefs({ timePicker: v })}
          />
        </div>
      </details>

      {/* Layout & motion */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Layout &amp; motion</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Card size</Label>
            <select
              className={SELECT}
              value={prefs.cardSize}
              onChange={(e) => setPrefs({ cardSize: e.target.value as CardSize })}
            >
              <option value="comfortable" className="bg-background">Comfortable</option>
              <option value="compact" className="bg-background">Compact</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Columns</Label>
            <select
              className={SELECT}
              value={prefs.taskColumns}
              onChange={(e) => setPrefs({ taskColumns: Number(e.target.value) })}
            >
              <option value={0} className="bg-background">Auto</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n} className="bg-background">
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Toast notifications</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={prefs.toasts}
            onChange={(e) => setPrefs({ toasts: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Use browser dialogs</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={prefs.nativeDialogs}
            onChange={(e) => setPrefs({ nativeDialogs: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Show calendar</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={prefs.showCalendar}
            onChange={(e) => setPrefs({ showCalendar: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Show activity chart</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={prefs.showActivity}
            onChange={(e) => setPrefs({ showActivity: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Draggable windows</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={prefs.draggableWindows}
            onChange={(e) => setPrefs({ draggableWindows: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Pause background while dragging or scrolling
            <span className="block text-xs">Only kicks in with frosted glass, where the blur is the cost</span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={prefs.pauseBgOnDrag}
            onChange={(e) => setPrefs({ pauseBgOnDrag: e.target.checked })}
          />
        </label>
      </section>

      <AnimationsSection />
    </div>
  );
}

/** One labelled on/off row of the Animations list. */
function AnimToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
      <span className="text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** Collapsible per-animation switches. The master toggle + speed mirror the
 *  ones in Theme (same preference, two homes); the granular switches let a
 *  single kind of motion be turned off while the rest keep animating. */
function AnimationsSection() {
  const { prefs, setPrefs } = usePrefs();
  const off = !prefs.animations; // granular toggles are moot with the master off

  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">Animations</summary>
      <div className="space-y-2.5 border-t p-3">
        <AnimToggle
          label="All animations"
          hint="Master switch — off disables everything below plus the background"
          checked={prefs.animations}
          onChange={(v) => setPrefs({ animations: v })}
        />
        {prefs.animations && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Animation speed: {prefs.animationSpeed}×</Label>
            <input
              type="range"
              min={0.25}
              max={2}
              step={0.25}
              value={prefs.animationSpeed}
              onChange={(e) => setPrefs({ animationSpeed: Number(e.target.value) })}
              className="w-full accent-primary"
              aria-label="Animation speed"
            />
          </div>
        )}
        <hr className="border-border/60" />
        <AnimToggle
          label="Task cards moving"
          hint="Cards glide to their new spot and fade in"
          checked={prefs.animGrid}
          disabled={off}
          onChange={(v) => setPrefs({ animGrid: v })}
        />
        <AnimToggle
          label="Action feedback"
          hint="Quick-log pulse, count pops, button press-down"
          checked={prefs.animFeedback}
          disabled={off}
          onChange={(v) => setPrefs({ animFeedback: v })}
        />
        <AnimToggle
          label="Sliding selection highlight"
          hint="The bubble that slides between tabs, views, and calendar days"
          checked={prefs.animIndicators}
          disabled={off}
          onChange={(v) => setPrefs({ animIndicators: v })}
        />
        <AnimToggle
          label="Windows and dialogs"
          hint="Open, close, and minimise motion"
          checked={prefs.animWindows}
          disabled={off}
          onChange={(v) => setPrefs({ animWindows: v })}
        />
        <AnimToggle
          label="View transitions"
          hint="Header crossfade, calendar month slide, list entrances"
          checked={prefs.animViews}
          disabled={off}
          onChange={(v) => setPrefs({ animViews: v })}
        />
        <hr className="border-border/60" />
        <AnimToggle
          label="Smooth wheel scrolling"
          hint="Eases mouse-wheel steps at your display's refresh rate (touchpads and touch stay native)"
          checked={prefs.smoothScroll}
          onChange={(v) => setPrefs({ smoothScroll: v })}
        />
      </div>
    </details>
  );
}
