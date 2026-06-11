import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Settings2, Zap } from "lucide-react";

import { api, type Task } from "@/lib/api";
import { formatDateTime, formatDue, formatInterval, timeSince } from "@/lib/time";
import { nextDue, stalenessTint } from "@/lib/staleness";
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

export function TaskCard({
  task,
  selectable = false,
  selected = false,
  onToggleSelected,
}: {
  task: Task;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}) {
  // Subscribe to the ticking clock so relative times / colours stay current.
  const now = useNow();
  const { prefs } = usePrefs();
  const status = stalenessTint(
    task,
    { fresh: prefs.taskColorFresh, overdue: prefs.taskColorOverdue, noRoutineFadeDays: prefs.noRoutineFadeDays },
    now,
  );
  const due = nextDue(task);
  const progress = status.progress;
  const compact = prefs.cardSize === "compact";
  const queryClient = useQueryClient();
  const { openManage, openComplete } = useTaskWindows();

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
            <CardTitle className="truncate text-base">{task.name}</CardTitle>
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
          <span className="ml-auto text-xs font-medium transition-colors duration-700" style={{ color: status.color }}>
            {status.label}
          </span>
        </div>

        {!compact && task.lastCompletedAt && (
          <p className="pl-[18px] text-xs text-muted-foreground">
            {formatDateTime(task.lastCompletedAt)}
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
            {!compact && (
              <p className="text-xs text-muted-foreground">
                every {formatInterval(task.intervalSeconds)}
                {due && (
                  <>
                    {" · "}
                    <span className={cn(formatDue(due, now).overdue && !task.freezeColor && "text-rose-400")}>
                      {formatDue(due, now).text}
                    </span>
                  </>
                )}
              </p>
            )}
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
  );
}
