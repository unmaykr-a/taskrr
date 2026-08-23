import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  Check,
  Clock,
  Copy,
  Moon,
  Pin,
  PinOff,
  Repeat,
  Settings2,
  SkipForward,
  Trash2,
  Users,
  Zap,
} from "lucide-react";

import { api, type Task } from "@/lib/api";
import { formatDate, formatDateTime, formatDue, formatInterval, timeSince } from "@/lib/time";
import { isSnoozed, nextDue, stalenessTint } from "@/lib/staleness";
import { isMyTurn, nextUp, rotationOrder } from "@/lib/rotation";
import { ensureContrast } from "@/lib/color";
import { usePrefs } from "@/lib/prefs";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTaskWindows } from "@/components/useTaskWindows";
import { ContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { SNOOZE_PRESETS, useTaskActions } from "@/components/useTaskActions";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";

export function TaskCard({
  task,
  selectable = false,
  selected = false,
  onToggleSelected,
  onTagClick,
}: {
  task: Task;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  onTagClick?: (tag: string) => void;
}) {
  // Subscribe to the ticking clock so relative times / colours stay current.
  const now = useNow();
  const { prefs } = usePrefs();
  const status = stalenessTint(
    task,
    {
      fresh: prefs.taskColorFresh,
      overdue: prefs.taskColorOverdue,
      noRoutineFadeDays: prefs.noRoutineFadeDays,
      disableFade: !prefs.colorFade,
    },
    now,
  );
  const due = nextDue(task);
  const progress = status.progress;
  const compact = prefs.cardSize === "compact";

  // The staleness tint is picked to look good as a *block* — the accent bar, the
  // dot, the progress fill — and those keep it exactly. The same colour set as
  // small text is a different problem: mid-gradient olives and ambers, and the
  // neutral grey of a never-done task, sit at ~2.5:1 on a white panel. So the
  // labels get the nearest readable version of the very same colour, which
  // leaves the hue (and the meaning it carries) intact on dark themes, where it
  // already passed and is returned untouched.
  const { theme } = useTheme();
  const surface = theme.colors.card;
  const labelColor = ensureContrast(status.color, surface);
  const overdueColor = ensureContrast(status.overdue, surface);
  const queryClient = useQueryClient();
  const { openManage, openComplete } = useTaskWindows();
  const actions = useTaskActions();
  const { user } = useAuth();
  // Scheduling and structure belong to the owner; a member of a shared task
  // gets only the actions they're actually allowed to perform.
  const isOwner = user ? task.ownerId === user.id : true;
  const snoozed = isSnoozed(task, now);
  const archived = task.archivedAt != null;

  // Rotation: only fetch members for a task that actually uses one. The key is
  // shared with the Manage window, so opening that costs nothing extra.
  const rotating = task.rotate && task.shared && !archived;
  const { data: members } = useQuery({
    queryKey: ["members", task.id],
    queryFn: () => api.listMembers(task.id),
    enabled: rotating,
  });
  const order = rotationOrder(members);
  const turn = rotating ? nextUp(order, task.lastCompletedBy) : null;
  const myTurn = rotating && isMyTurn(order, task.lastCompletedBy, user?.username);

  // Built lazily by the menu on open, so labels track current state.
  const menuEntries = (): ContextMenuEntry[] => {
    const entries: ContextMenuEntry[] = [];
    if (!archived) {
      entries.push({ label: "Quick log", icon: <Zap />, onSelect: () => actions.quickLog.mutate(task) });
      entries.push({ label: "Log with time…", icon: <Clock />, onSelect: () => openComplete(task) });
    }
    entries.push({ label: "Manage…", icon: <Settings2 />, onSelect: () => openManage(task) });

    if (isOwner && !archived) {
      entries.push({ separator: true });
      if (snoozed) {
        entries.push({ label: "Wake up now", icon: <BellOff />, onSelect: () => actions.wake.mutate(task) });
      } else {
        for (const preset of SNOOZE_PRESETS) {
          entries.push({
            label: `Snooze ${preset.label}`,
            icon: <Moon />,
            onSelect: () => actions.snooze.mutate({ task, hours: preset.hours }),
          });
        }
      }
      entries.push({
        label: "Skip this cycle",
        icon: <SkipForward />,
        // Only a routine has a cycle to skip; shown-but-disabled explains why
        // the action exists without pretending it applies here.
        disabled: task.intervalSeconds == null,
        onSelect: () => actions.skip.mutate(task),
      });
    }

    if (isOwner) {
      entries.push({ separator: true });
      entries.push({
        label: task.pinned ? "Unpin" : "Pin to top",
        icon: task.pinned ? <PinOff /> : <Pin />,
        onSelect: () => actions.pin.mutate({ task, pinned: !task.pinned }),
      });
      entries.push({ label: "Duplicate", icon: <Copy />, onSelect: () => actions.duplicate.mutate(task) });
      entries.push({
        label: archived ? "Restore" : "Archive",
        icon: archived ? <ArchiveRestore /> : <Archive />,
        onSelect: () => actions.archive.mutate({ task, archived: !archived }),
      });
      entries.push({ separator: true });
    }
    entries.push({
      label: isOwner ? "Delete" : "Leave task",
      icon: <Trash2 />,
      destructive: true,
      onSelect: () => void actions.confirmDelete(task),
    });
    return entries;
  };

  // Quick log: one tap records "done right now". `justLogged` drives the brief
  // success state (check on the button + a pulse ring on the card).
  const [justLogged, setJustLogged] = useState(false);
  useEffect(() => {
    if (!justLogged) return;
    const id = setTimeout(() => setJustLogged(false), 1400);
    return () => clearTimeout(id);
  }, [justLogged]);
  const quick = useMutation({
    mutationFn: () => api.quickComplete(task.id),
    onSuccess: () => {
      setJustLogged(true);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["completions", task.id] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });

  return (
    <ContextMenu entries={menuEntries} disabled={selectable}>
    <Card
      data-flip-key={task.id}
      className={cn(
        // Plain bg-card — when the theme's frosted-glass mode is on, the
        // `.frosted .bg-card` rule frosts these cards along with windows/sidebar.
        // Hover lifts the card slightly; the staleness recolour after a log is
        // smoothed by the colour transitions on the bar/dot below.
        "relative flex flex-col overflow-hidden transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        selectable && "cursor-pointer",
        selected && "ring-2 ring-primary",
        justLogged && prefs.animFeedback && "animate-log-pulse",
      )}
      onClick={selectable ? onToggleSelected : undefined}
    >
      {/* The whole bar is one colour, the %-interpolation along fresh→overdue,
          so it fades over time rather than being a left→right two-tone. The slow
          colour transition makes the post-log green sweep visible. */}
      <span
        className="absolute inset-x-0 top-0 h-1 transition-colors duration-700"
        style={{ backgroundColor: status.color }}
      />

      <CardHeader className={compact ? "pb-1 pt-3" : "pb-3 pt-6"}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {selectable && (
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}
              >
                {selected && <Check className="h-3.5 w-3.5" />}
              </span>
            )}
            {task.pinned && (
              <Pin className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Pinned" />
            )}
            <CardTitle className="truncate text-base">{task.name}</CardTitle>
            {task.shared && (
              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Shared task" />
            )}
          </div>
          {/* Keyed by the count so each new log pops the badge in. */}
          <Badge
            key={task.completionCount}
            variant="secondary"
            className={cn("shrink-0", prefs.animFeedback && "animate-in zoom-in-50 duration-300")}
            title="Times logged"
          >
            {task.completionCount}×
          </Badge>
        </div>
        {!compact && task.description && (
          <CardDescription className="line-clamp-2">{task.description}</CardDescription>
        )}
      </CardHeader>

      <CardContent className={cn("flex-1", compact ? "pb-2" : "space-y-2 pb-4")}>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full transition-colors duration-700"
            style={{ backgroundColor: status.color }}
          />
          <span className="text-sm font-medium">{timeSince(task.lastCompletedAt)}</span>
          <span className="ml-auto text-xs font-medium transition-colors duration-700" style={{ color: labelColor }}>
            {status.label}
          </span>
        </div>

        {turn && (
          <p
            className={cn(
              "flex items-center gap-1 pl-[18px] text-xs",
              myTurn ? "font-medium text-primary" : "text-muted-foreground",
            )}
          >
            <Repeat className="h-3 w-3 shrink-0" />
            {myTurn ? "Your turn" : `${turn}'s turn`}
          </p>
        )}

        {!compact && task.lastCompletedAt && (
          <p className="pl-[18px] text-xs text-muted-foreground">
            {formatDateTime(task.lastCompletedAt)}
            {task.shared && task.lastCompletedBy && (
              <span> · by {task.lastCompletedBy}</span>
            )}
          </p>
        )}

        {/* Cadence row: only shown when the task has a routine. */}
        {task.intervalSeconds != null && (
          <div className={cn("pl-[18px]", compact && "mt-1.5")}>
            {progress != null && (
              <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-muted">
                {/* Eased so a post-log reset sweeps back instead of snapping. */}
                <div
                  className="h-full rounded-full transition-[width,background-color] duration-500 ease-out"
                  style={{
                    width: `${Math.min(100, Math.round(progress * 100))}%`,
                    backgroundColor: status.color,
                  }}
                />
              </div>
            )}
            {!compact && snoozed && task.snoozedUntil && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Moon className="h-3 w-3 shrink-0" />
                snoozed until {formatDate(new Date(task.snoozedUntil))}
              </p>
            )}
            {!compact && !snoozed && (
              <p className="text-xs text-muted-foreground">
                every {formatInterval(task.intervalSeconds)}
                {due && (
                  <>
                    {" · "}
                    {/* Tinted with the task's own overdue colour (a fixed rose
                        ignored a per-task palette) at a readable strength. */}
                    <span
                      style={
                        formatDue(due, now).overdue && !task.freezeColor && prefs.colorFade
                          ? { color: overdueColor }
                          : undefined
                      }
                    >
                      {formatDue(due, now).text}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {!compact && snoozed && task.snoozedUntil && task.intervalSeconds == null && (
          <p className="flex items-center gap-1 pl-[18px] text-xs text-muted-foreground">
            <Moon className="h-3 w-3 shrink-0" />
            snoozed until {formatDate(new Date(task.snoozedUntil))}
          </p>
        )}

        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {task.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick?.(tag);
                }}
                className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground transition-colors hover:bg-secondary/70"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter
        className={cn("gap-2 border-t", compact ? "pt-2" : "pt-4", selectable && "pointer-events-none opacity-50")}
      >
        {/* 1. Quick log — instant, with a brief "Logged" confirmation. While the
            confirmation shows, the button is inert (the card may have just moved
            under the cursor via the grid animation — guards an accidental double
            log) but keeps full opacity so it reads as success, not disabled. */}
        <Button
          className={cn("flex-1", justLogged && "disabled:opacity-100")}
          size={compact ? "sm" : "default"}
          disabled={quick.isPending || justLogged}
          onClick={() => quick.mutate()}
        >
          {justLogged ? (
            <>
              <Check className={cn(prefs.animFeedback && "animate-in zoom-in-50 duration-200")} /> Logged
            </>
          ) : (
            <>
              <Zap /> {quick.isPending ? "Logging…" : "Quick log"}
            </>
          )}
        </Button>
        {/* 2. Advanced — pick a time / add a note (opens a window). */}
        <Button variant="outline" size="icon" aria-label="Log with time and note" onClick={() => openComplete(task)}>
          <Clock />
        </Button>
        {/* 3. Manage — edit, history, delete (opens a window). */}
        <Button variant="outline" size="icon" aria-label="Manage task" onClick={() => openManage(task)}>
          <Settings2 />
        </Button>
      </CardFooter>
    </Card>
    </ContextMenu>
  );
}
