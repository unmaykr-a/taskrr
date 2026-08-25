import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CheckCheck,
  FolderInput as FolderIcon,
  Moon,
  Repeat,
  SkipForward,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { api, type Task, type TaskInput } from "@/lib/api";
import { folderNames } from "@/lib/folders";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FolderInput } from "@/components/ui/FolderInput";
import { TagInput } from "@/components/ui/TagInput";
import { IntervalField } from "@/components/IntervalField";
import { SNOOZE_PRESETS } from "@/components/useTaskActions";

type BulkAction = "done" | "archive" | "unarchive" | "delete" | "tag" | "folder" | "snooze" | "skip" | "routine";

/** Which inline editor the bar has swapped its buttons for, if any. */
type Panel = null | "delete" | "tag" | "folder" | "snooze" | "routine";

/**
 * The task-update endpoint is a whole-object PATCH, not a partial one — omitted
 * fields are cleared, not left alone. So a bulk edit has to send each task back
 * intact with only the touched field changed.
 */
function toInput(task: Task, patch: Partial<TaskInput>): TaskInput {
  return {
    name: task.name,
    description: task.description,
    intervalSeconds: task.intervalSeconds,
    colorFresh: task.colorFresh,
    colorOverdue: task.colorOverdue,
    freezeColor: task.freezeColor,
    tags: task.tags,
    folder: task.folder,
    ...patch,
  };
}

/**
 * BulkBar is the floating action bar shown while tasks are multi-selected. It
 * runs the chosen action across every selected id (client-side fan-out over the
 * existing endpoints — fine for a self-hosted, small-N tool) and refreshes the
 * affected queries.
 *
 * Actions that need input (delete's confirmation, tagging, moving to a folder)
 * swap the button row for a small inline editor rather than opening a dialog,
 * which keeps the whole interaction inside one thumb-sized surface on a phone.
 */
export function BulkBar({
  tasks,
  ids,
  archivedView,
  onClear,
}: {
  /** Every task in the current view, so a bulk edit can rebuild full payloads. */
  tasks: Task[];
  ids: number[];
  archivedView: boolean;
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const { prefs } = usePrefs();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [snoozeHours, setSnoozeHours] = useState(SNOOZE_PRESETS[1].hours);
  // null is a real choice here — it clears the routine, turning a selection back
  // into plain "how long since" tasks.
  const [routine, setRoutine] = useState<number | null>(7 * 86_400);
  const [tags, setTags] = useState<string[]>([]);
  const [folder, setFolder] = useState("");

  const selected = tasks.filter((t) => ids.includes(t.id));
  const folderSuggestions = folderNames(queryClient.getQueryData<Task[]>(["tasks"]) ?? []);

  const run = useMutation({
    mutationFn: async (action: BulkAction) => {
      if (action === "done") await Promise.all(ids.map((id) => api.quickComplete(id)));
      else if (action === "archive") await Promise.all(ids.map((id) => api.archiveTask(id)));
      else if (action === "unarchive") await Promise.all(ids.map((id) => api.unarchiveTask(id)));
      else if (action === "delete") await Promise.all(ids.map((id) => api.deleteTask(id)));
      else if (action === "snooze") {
        const until = new Date(Date.now() + snoozeHours * 3_600_000).toISOString();
        await Promise.all(ids.map((id) => api.snoozeTask(id, until)));
      } else if (action === "routine") {
        await Promise.all(selected.map((t) => api.updateTask(t.id, toInput(t, { intervalSeconds: routine }))));
      } else if (action === "skip") {
        // Only routines have a cycle to skip. Filtering here rather than
        // disabling the button means a mixed selection does the sensible thing
        // instead of failing whole.
        await Promise.all(
          selected.filter((t) => t.intervalSeconds != null).map((t) => api.skipTask(t.id)),
        );
      }
      else if (action === "tag") {
        // Add, don't replace: bulk-tagging a mixed selection should never be a
        // silent way to wipe tags the other tasks already had. Matching is
        // case-insensitive so "Home" doesn't join an existing "home".
        await Promise.all(
          selected.map((t) => {
            const have = new Set(t.tags.map((x) => x.toLowerCase()));
            const merged = [...t.tags, ...tags.filter((x) => !have.has(x.toLowerCase()))];
            return api.updateTask(t.id, toInput(t, { tags: merged }));
          }),
        );
      } else {
        // Folder is a single value, so this one genuinely is a replace — an
        // empty string moves the selection out of any folder.
        await Promise.all(selected.map((t) => api.updateTask(t.id, toInput(t, { folder: folder.trim() }))));
      }
    },
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      setPanel(null);
      setTags([]);
      setFolder("");
      const labels: Record<BulkAction, string> = {
        done: "Logged",
        archive: "Archived",
        unarchive: "Restored",
        delete: "Deleted",
        tag: "Tagged",
        folder: "Moved",
        snooze: "Snoozed",
        skip: "Skipped",
        routine: routine == null ? "Cleared the routine on" : "Set a routine on",
      };
      // Skip only touches the routines in the selection, so it has to count
      // what it actually did rather than what was ticked.
      const count = action === "skip" ? selected.filter((t) => t.intervalSeconds != null).length : ids.length;
      const n = `${count} ${count === 1 ? "task" : "tasks"}`;
      toast(`${labels[action]} ${n}`, { tone: "success" });
      // Tagging and moving keep the selection, so several edits can be made in
      // a row; the destructive and state-changing ones dismiss the bar.
      if (action !== "tag" && action !== "folder") onClear();
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const busy = run.isPending;

  return (
    // slide-in-from-left-1/2 keeps the enter keyframe's x at -50% so the rise
    // from the bottom doesn't fight the -translate-x-1/2 centering.
    // max-w + wrapping keeps the bar inside a 320px phone once the extra
    // actions are in it.
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[47] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border bg-card/95 px-2 py-1.5 shadow-xl backdrop-blur sm:gap-2 sm:rounded-full pill-surface",
        prefs.animViews && "animate-in fade-in-0 slide-in-from-left-1/2 slide-in-from-bottom-4 duration-300",
      )}
    >
      <span className="px-1 text-sm font-medium tabular-nums sm:px-2">{ids.length} selected</span>

      {panel === "delete" && (
        <>
          <span className="text-sm text-muted-foreground">Delete {ids.length}?</span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => run.mutate("delete")}>
            {busy ? "Deleting…" : "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
            No
          </Button>
        </>
      )}

      {panel === "tag" && (
        <>
          <div className="min-w-[10rem] flex-1 basis-48">
            <TagInput value={tags} onChange={setTags} />
          </div>
          <Button size="sm" disabled={busy || tags.length === 0} onClick={() => run.mutate("tag")}>
            {busy ? "Adding…" : "Add"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
            Cancel
          </Button>
        </>
      )}

      {panel === "folder" && (
        <>
          <div className="min-w-[10rem] flex-1 basis-48">
            <FolderInput value={folder} onChange={setFolder} suggestions={folderSuggestions} />
          </div>
          <Button size="sm" disabled={busy} onClick={() => run.mutate("folder")}>
            {busy ? "Moving…" : folder.trim() ? "Move" : "Clear"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
            Cancel
          </Button>
        </>
      )}

      {panel === "routine" && (
        <>
          <div className="min-w-[13rem]">
            <IntervalField value={routine} onChange={setRoutine} />
          </div>
          <Button size="sm" disabled={busy} onClick={() => run.mutate("routine")}>
            Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
            Cancel
          </Button>
        </>
      )}

      {panel === "snooze" && (
        <>
          <span className="px-1 text-xs text-muted-foreground">Snooze until</span>
          <Select
            value={snoozeHours}
            autoFocus
            onChange={(e) => setSnoozeHours(Number(e.target.value))}
            aria-label="Snooze for"
            className="h-8 text-xs"
          >
            {SNOOZE_PRESETS.map((p) => (
              <option key={p.hours} value={p.hours}>
                {p.label}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={busy} onClick={() => run.mutate("snooze")}>
            Snooze
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
            Cancel
          </Button>
        </>
      )}

      {panel === null && (
        <>
          {!archivedView && (
            <BulkButton icon={<CheckCheck />} label="Done" disabled={busy} onClick={() => run.mutate("done")} />
          )}
          {!archivedView && (
            <>
              <BulkButton icon={<Moon />} label="Snooze" disabled={busy} onClick={() => setPanel("snooze")} />
              <BulkButton
                icon={<SkipForward />}
                label="Skip"
                // Nothing to skip when the selection is all one-offs.
                disabled={busy || !selected.some((t) => t.intervalSeconds != null)}
                onClick={() => run.mutate("skip")}
              />
            </>
          )}
          {!archivedView && (
            <BulkButton icon={<Repeat />} label="Routine" disabled={busy} onClick={() => setPanel("routine")} />
          )}
          <BulkButton icon={<Tag />} label="Tag" disabled={busy} onClick={() => setPanel("tag")} />
          <BulkButton icon={<FolderIcon />} label="Folder" disabled={busy} onClick={() => setPanel("folder")} />
          {archivedView ? (
            <BulkButton
              icon={<ArchiveRestore />}
              label="Restore"
              disabled={busy}
              onClick={() => run.mutate("unarchive")}
            />
          ) : (
            <BulkButton icon={<Archive />} label="Archive" disabled={busy} onClick={() => run.mutate("archive")} />
          )}
          <BulkButton icon={<Trash2 />} label="Delete" disabled={busy} onClick={() => setPanel("delete")} />
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Clear selection" onClick={onClear}>
            <X />
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * One action in the bar. Six labelled buttons don't fit a phone, so the text is
 * hidden below `sm` and moves to the accessible name instead — the icons stay
 * full-size targets either way.
 */
function BulkButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="px-2 sm:px-3"
    >
      {icon} <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
