import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Keyboard,
  LayoutGrid,
  Palette,
  Bookmark as BookmarkIcon,
  Sparkles,
  SlidersHorizontal,
  Tag as TagIcon,
} from "lucide-react";

import {
  type AddButtonPosition,
  type CardSize,
  type ClockChoice,
  type DateOrder,
  usePrefs,
} from "@/lib/prefs";
import { type Task } from "@/lib/api";
import { setTagColor, tagColor } from "@/lib/tagColors";
import { deleteTemplate } from "@/lib/templates";
import { formatInterval } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/Segmented";
import { ColorField } from "@/components/ui/ColorPicker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { ToggleRow } from "@/components/ui/ToggleRow";

/**
 * Per-user preferences that aren't strictly "theme".
 *
 * Grouped rather than listed: this pane had grown to two dozen switches in one
 * column, where finding "keyboard shortcuts" meant scrolling past every colour
 * and animation setting. Each group is shut until you want it, and remembers
 * that per device.
 */
export function PreferencesSection() {
  const { prefs, setPrefs } = usePrefs();

  return (
    <div className="space-y-2">
      <SettingsGroup
        id="prefs.time"
        title="Time &amp; date"
        icon={<CalendarClock />}
        flat
      >
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
      </SettingsGroup>

      <SettingsGroup
        id="prefs.colours"
        title="Task colours"
        icon={<Palette />}
        summary="Fresh to overdue, fading"
      >
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
        <ToggleRow
          label="Fade colours over time"
          hint="Off keeps every task at its recent colour — no need for per-task freeze."
          checked={prefs.colorFade}
          onChange={(v) => setPrefs({ colorFade: v })}
        />
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
      </SettingsGroup>

      <TagColoursGroup />

      <TemplatesGroup />

      <SettingsGroup
        id="prefs.layout"
        title="Layout"
        icon={<LayoutGrid />}
        summary="Cards, columns, panels"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Card size</Label>
            <Select
              value={prefs.cardSize}
              onChange={(e) => setPrefs({ cardSize: e.target.value as CardSize })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Columns</Label>
            <Select
              value={prefs.taskColumns}
              onChange={(e) => setPrefs({ taskColumns: Number(e.target.value) })}
            >
              <option value={0}>Auto</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {/* Lived under Task colours until now, which is nobody's first guess. */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Add button (mobile)</Label>
          <Select
            value={prefs.addButton}
            onChange={(e) => setPrefs({ addButton: e.target.value as AddButtonPosition })}
          >
            <option value="top">Top right</option>
            <option value="bottom">Bottom (FAB)</option>
          </Select>
        </div>
        <ToggleRow
          label="Show calendar"
          checked={prefs.showCalendar}
          onChange={(v) => setPrefs({ showCalendar: v })}
        />
        <ToggleRow
          label="Show activity chart"
          checked={prefs.showActivity}
          onChange={(v) => setPrefs({ showActivity: v })}
        />
        <ToggleRow
          label="Task statistics"
          hint="A task's typical gap, longest gap, and how it tracks against its routine, in its Manage window"
          checked={prefs.showTaskStats}
          onChange={(v) => setPrefs({ showTaskStats: v })}
        />
        <ToggleRow
          label="Count in the browser tab"
          hint="Puts the number of overdue and due-soon tasks in the tab title, for a pinned tab"
          checked={prefs.tabBadge}
          onChange={(v) => setPrefs({ tabBadge: v })}
        />
        <ToggleRow
          label="Draggable windows"
          checked={prefs.draggableWindows}
          onChange={(v) => setPrefs({ draggableWindows: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        id="prefs.behaviour"
        title="Shortcuts &amp; input"
        icon={<Keyboard />}
        summary="Right-click, keys, quick add"
      >
        <ToggleRow
          label="Right-click menu"
          hint="Right-click a task (or long-press on a touchscreen) for its actions. Off restores your browser's own menu."
          checked={prefs.contextMenu}
          onChange={(v) => setPrefs({ contextMenu: v })}
        />
        <ToggleRow
          label="Keyboard shortcuts"
          hint="Single keys for new task, search, and switching views — press ? for the list"
          checked={prefs.keyboardShortcuts}
          onChange={(v) => setPrefs({ keyboardShortcuts: v })}
        />
        <ToggleRow
          label="Quick add"
          hint={'Offer to read "every 2 weeks #home /Kitchen" out of a new task\'s name'}
          checked={prefs.quickAdd}
          onChange={(v) => setPrefs({ quickAdd: v })}
        />
        <ToggleRow
          label="Toast notifications"
          hint="Brief confirmations after an action — this is also where Undo appears after a log"
          checked={prefs.toasts}
          onChange={(v) => setPrefs({ toasts: v })}
        />
        <ToggleRow
          label="Use browser dialogs"
          hint="System confirm boxes instead of Taskrr's own"
          checked={prefs.nativeDialogs}
          onChange={(v) => setPrefs({ nativeDialogs: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        id="prefs.pickers"
        title="Pickers"
        icon={<SlidersHorizontal />}
        summary="Colour, date, time inputs"
      >
        <p className="text-[11px] text-muted-foreground">
          Taskrr's own pickers are on by default; turn one off to use your device's native control.
        </p>
        <ToggleRow
          label="Custom colour picker"
          hint="A colour wheel instead of the system picker"
          checked={prefs.colorPicker === "wheel"}
          onChange={(v) => setPrefs({ colorPicker: v ? "wheel" : "native" })}
        />
        <ToggleRow
          label="Custom date picker"
          hint="A calendar instead of the system date input"
          checked={prefs.datePicker}
          onChange={(v) => setPrefs({ datePicker: v })}
        />
        <ToggleRow
          label="Custom time picker"
          hint="An analog clock instead of the system time input"
          checked={prefs.timePicker}
          onChange={(v) => setPrefs({ timePicker: v })}
        />
      </SettingsGroup>

      <AnimationsGroup />
    </div>
  );
}

/**
 * The saved task templates, so they can be renamed away or cleared out.
 *
 * They are created from a task's right-click menu rather than here — a template
 * is made *from* something, so a form for typing one from scratch would just be
 * the new-task form again.
 */
function TemplatesGroup() {
  const { prefs, setPrefs } = usePrefs();
  const templates = prefs.taskTemplates ?? [];

  return (
    <SettingsGroup
      id="prefs.templates"
      title="Task templates"
      icon={<BookmarkIcon />}
      summary={templates.length > 0 ? `${templates.length} saved` : "None yet"}
    >
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Right-click a task and choose <span className="font-medium">Save as template</span> to reuse its
          setup on a new one.
        </p>
      ) : (
        templates.map((t) => (
          <div key={t.name} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="truncate">{t.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  t.intervalSeconds != null ? `every ${formatInterval(t.intervalSeconds)}` : "no routine",
                  t.folder ? `in ${t.folder}` : null,
                  t.tags.length > 0 ? t.tags.map((x) => `#${x}`).join(" ") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrefs({ taskTemplates: deleteTemplate(templates, t.name) })}
              className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
            >
              remove
            </button>
          </div>
        ))
      )}
    </SettingsGroup>
  );
}

/**
 * A colour per tag, for lists that have outgrown one colour for all of them.
 *
 * Only tags in use are offered, and only tags somebody coloured are stored, so
 * the group is empty (and says so) until there are tags to colour.
 */
function TagColoursGroup() {
  const { prefs, setPrefs } = usePrefs();
  const queryClient = useQueryClient();
  const tasks = queryClient.getQueryData<Task[]>(["tasks"]) ?? [];
  // First spelling wins, matching how tags are de-duplicated elsewhere.
  const seen = new Map<string, string>();
  for (const t of tasks) for (const tag of t.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  const tags = [...seen.values()].sort((a, b) => a.localeCompare(b));
  const coloured = Object.keys(prefs.tagColors ?? {}).length;

  return (
    <SettingsGroup
      id="prefs.tagColours"
      title="Tag colours"
      icon={<TagIcon />}
      summary={coloured > 0 ? `${coloured} coloured` : "All one colour"}
    >
      {tags.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tags yet. Add one to a task and it'll show up here.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Tags you don't colour keep the plain chip.
          </p>
          {tags.map((tag) => {
            const hex = tagColor(prefs.tagColors, tag);
            return (
              <div key={tag} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">{tag}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {hex && (
                    <button
                      type="button"
                      onClick={() => setPrefs({ tagColors: setTagColor(prefs.tagColors, tag, null) })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      clear
                    </button>
                  )}
                  <ColorField
                    label=""
                    value={hex ?? prefs.taskColorFresh}
                    onChange={(v) => setPrefs({ tagColors: setTagColor(prefs.tagColors, tag, v) })}
                  />
                </div>
              </div>
            );
          })}
          {coloured > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setPrefs({ tagColors: {} })}
            >
              Clear all tag colours
            </Button>
          )}
        </>
      )}
    </SettingsGroup>
  );
}

/** The per-animation switches. The master toggle and speed mirror the ones in
 *  Theme (same preference, two homes); the granular switches let one kind of
 *  motion be turned off while the rest keep animating. */
function AnimationsGroup() {
  const { prefs, setPrefs } = usePrefs();
  const off = !prefs.animations; // granular toggles are moot with the master off

  return (
    <SettingsGroup
      id="prefs.animations"
      title="Animations"
      icon={<Sparkles />}
      summary={prefs.animations ? "Motion, speed" : "All off"}
    >
      <ToggleRow
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
      <ToggleRow
        label="Task cards moving"
        hint="Cards glide to their new spot and fade in"
        checked={prefs.animGrid}
        disabled={off}
        onChange={(v) => setPrefs({ animGrid: v })}
      />
      <ToggleRow
        label="Action feedback"
        hint="Quick-log pulse, count pops, button press-down"
        checked={prefs.animFeedback}
        disabled={off}
        onChange={(v) => setPrefs({ animFeedback: v })}
      />
      <ToggleRow
        label="Sliding selection highlight"
        hint="The bubble that slides between tabs, views, and calendar days"
        checked={prefs.animIndicators}
        disabled={off}
        onChange={(v) => setPrefs({ animIndicators: v })}
      />
      <ToggleRow
        label="Windows and dialogs"
        hint="Open, close, and minimise motion"
        checked={prefs.animWindows}
        disabled={off}
        onChange={(v) => setPrefs({ animWindows: v })}
      />
      <ToggleRow
        label="View transitions"
        hint="Header crossfade, calendar month slide, list entrances"
        checked={prefs.animViews}
        disabled={off}
        onChange={(v) => setPrefs({ animViews: v })}
      />
      <ToggleRow
        label="Smooth wheel scrolling"
        hint="Eases mouse-wheel steps at your display's refresh rate (touchpads and touch stay native)"
        checked={prefs.smoothScroll}
        disabled={off}
        onChange={(v) => setPrefs({ smoothScroll: v })}
      />
      <ToggleRow
        label="Pause background while dragging or scrolling"
        hint="Only kicks in with frosted glass, where the blur is the cost"
        checked={prefs.pauseBgOnDrag}
        disabled={off}
        onChange={(v) => setPrefs({ pauseBgOnDrag: v })}
      />
    </SettingsGroup>
  );
}
