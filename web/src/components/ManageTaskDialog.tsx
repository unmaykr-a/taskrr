import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";

import { api, type Completion, type Task } from "@/lib/api";
import { formatDateTime } from "@/lib/time";
import { usePrefs } from "@/lib/prefs";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/ColorPicker";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IntervalField } from "@/components/IntervalField";

/**
 * ManageTaskPanel is the "manage" surface for a task, rendered as the body of
 * a floating window (so several tasks can be managed side by side). It bundles:
 *   1. Edit    — name / description / cadence / colours
 *   2. History — see and undo individual completions
 *   3. Delete  — remove the task and its history (with a confirm step)
 *
 * `onClose` closes the owning window (after a successful save or delete).
 */
export function ManageTaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Edit the task, review its history, or delete it.</p>

      <EditSection task={task} onDone={onClose} />

      <hr className="border-border/60" />
      <HistorySection task={task} />

      <hr className="border-border/60" />
      <DangerZone task={task} onDeleted={onClose} />
    </div>
  );
}

function EditSection({ task, onDone }: { task: Task; onDone: () => void }) {
  const { prefs } = usePrefs();
  const nameId = useId();
  const descId = useId();
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description);
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(task.intervalSeconds);
  const [colorFresh, setColorFresh] = useState<string | null>(task.colorFresh);
  const [colorOverdue, setColorOverdue] = useState<string | null>(task.colorOverdue);
  const [freezeColor, setFreezeColor] = useState(task.freezeColor);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      api.updateTask(task.id, {
        name: name.trim(),
        description: description.trim(),
        intervalSeconds,
        colorFresh,
        colorOverdue,
        freezeColor,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) mutation.mutate();
      }}
      className="space-y-3"
    >
      <div className="space-y-2">
        <Label htmlFor={nameId}>Name</Label>
        <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={descId}>Description</Label>
        <Textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>
      <IntervalField value={intervalSeconds} onChange={setIntervalSeconds} />

      <div className="space-y-2">
        <Label>Colours</Label>
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="Recent"
            value={colorFresh ?? prefs.taskColorFresh}
            isDefault={colorFresh == null}
            onChange={setColorFresh}
            onClear={() => setColorFresh(null)}
          />
          <ColorField
            label="Overdue"
            value={colorOverdue ?? prefs.taskColorOverdue}
            isDefault={colorOverdue == null}
            onChange={setColorOverdue}
            onClear={() => setColorOverdue(null)}
          />
        </div>
        <div
          className="h-1.5 rounded-full"
          style={{
            background: freezeColor
              ? (colorFresh ?? prefs.taskColorFresh)
              : `linear-gradient(90deg, ${colorFresh ?? prefs.taskColorFresh}, ${
                  colorOverdue ?? prefs.taskColorOverdue
                })`,
          }}
        />
        <label className="flex items-center justify-between gap-2 pt-1 text-sm">
          <span className="text-muted-foreground">
            Freeze colour
            <span className="block text-xs">Stay at the recent colour — never fades to overdue</span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={freezeColor}
            onChange={(e) => setFreezeColor(e.target.checked)}
          />
        </label>
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function HistorySection({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const { data: completions, isLoading } = useQuery({
    queryKey: ["completions", task.id],
    queryFn: () => api.listCompletions(task.id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["completions", task.id] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">History</p>
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {completions && completions.length === 0 && (
          <p className="text-sm text-muted-foreground">No completions logged yet.</p>
        )}
        {completions?.map((c) => (
          <HistoryRow key={c.id} completion={c} onChanged={invalidate} />
        ))}
      </div>
    </div>
  );
}

// HistoryRow shows one completion and lets you edit its time/note in place
// (PATCH /api/completions/{id}) or delete it.
function HistoryRow({ completion: c, onChanged }: { completion: Completion; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => new Date(c.completedAt));
  const [note, setNote] = useState(c.note);

  const save = useMutation({
    mutationFn: () =>
      api.updateCompletion(c.id, { completedAt: when.toISOString(), note: note.trim() || undefined }),
    onSuccess: () => {
      onChanged();
      setEditing(false);
    },
  });
  const del = useMutation({ mutationFn: () => api.deleteCompletion(c.id), onSuccess: onChanged });

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
        <DateTimePicker value={when} onChange={setWhen} max={new Date()} />
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Note (optional)"
        />
        {save.isError && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setWhen(new Date(c.completedAt));
              setNote(c.note);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{formatDateTime(c.completedAt)}</p>
        {c.note && <p className="mt-0.5 break-words text-sm text-muted-foreground">{c.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Edit this entry"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Delete this entry"
          disabled={del.isPending}
          onClick={() => del.mutate()}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

function DangerZone({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const archived = task.archivedAt != null;

  const mutation = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      onDeleted();
    },
  });

  const archive = useMutation({
    mutationFn: () => (archived ? api.unarchiveTask(task.id) : api.archiveTask(task.id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onDeleted();
    },
  });

  if (!confirming) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={archive.isPending} onClick={() => archive.mutate()}>
          {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore" : "Archive"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 /> Delete task
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Delete “{task.name}” and its {task.completionCount} logged completion
        {task.completionCount === 1 ? "" : "s"}? This can’t be undone.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Deleting…" : "Yes, delete"}
        </Button>
      </div>
    </div>
  );
}
