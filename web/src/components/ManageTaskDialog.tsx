import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, LogOut, Pencil, Trash2, UserPlus, Users } from "lucide-react";

import { api, type Completion, type Task } from "@/lib/api";
import { formatDateTime } from "@/lib/time";
import { usePrefs } from "@/lib/prefs";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/Toast";
import { ColorField } from "@/components/ui/ColorPicker";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IntervalField } from "@/components/IntervalField";
import { TagInput } from "@/components/ui/TagInput";
import { FolderInput } from "@/components/ui/FolderInput";
import { folderNames } from "@/lib/folders";

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
  const { user } = useAuth();
  // A member (not the owner) can log and review history and leave, but not edit
  // or archive the definition — those stay with the owner.
  const isOwner = user ? task.ownerId === user.id : true;

  return (
    <div className="space-y-4">
      {isOwner ? (
        <>
          <p className="text-sm text-muted-foreground">Edit the task, review its history, or delete it.</p>
          <EditSection task={task} onDone={onClose} />
        </>
      ) : (
        <div>
          <h3 className="text-base font-semibold">{task.name}</h3>
          {task.description && <p className="mt-0.5 text-sm text-muted-foreground">{task.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Shared with you — log it and review the history, or leave it below.
          </p>
        </div>
      )}

      <ShareSection task={task} isOwner={isOwner} onLeft={onClose} />

      <hr className="border-border/60" />
      <HistorySection task={task} />

      {isOwner && (
        <>
          <hr className="border-border/60" />
          <DangerZone task={task} onDeleted={onClose} />
        </>
      )}
    </div>
  );
}

// ShareSection is the collaboration surface, shown only when the admin has
// enabled sharing. The owner invites people (by username) and sees the member
// list; a member sees who's on it and can leave.
function ShareSection({ task, isOwner, onLeft }: { task: Task; isOwner: boolean; onLeft: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const { data: members } = useQuery({
    queryKey: ["members", task.id],
    queryFn: () => api.listMembers(task.id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["members", task.id] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const share = useMutation({
    mutationFn: () => api.shareTask(task.id, username.trim()),
    onSuccess: () => {
      setUsername("");
      invalidate();
      toast("Invitation sent", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const leave = useMutation({
    mutationFn: () => api.leaveTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast("You left the task", { tone: "success" });
      onLeft();
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  if (!config?.tasksShareable) return null;

  return (
    <div className="space-y-2">
      <hr className="border-border/60" />
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Users className="h-4 w-4" /> Sharing
      </p>

      {members && members.length > 0 && (
        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{m.username}</span>
              <span className="shrink-0 text-xs capitalize text-muted-foreground">
                {m.status === "pending" ? "invited" : m.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOwner ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) share.mutate();
          }}
          className="flex gap-2 pt-1"
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Share with username"
            aria-label="Username to share with"
          />
          <Button type="submit" size="sm" disabled={!username.trim() || share.isPending}>
            <UserPlus /> Share
          </Button>
        </form>
      ) : (
        <div className="pt-1">
          <Button variant="outline" size="sm" disabled={leave.isPending} onClick={() => leave.mutate()}>
            <LogOut /> Leave task
          </Button>
        </div>
      )}
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
  const [tags, setTags] = useState<string[]>(task.tags);
  const [folder, setFolder] = useState(task.folder);
  const queryClient = useQueryClient();
  const folderSuggestions = folderNames(queryClient.getQueryData<Task[]>(["tasks"]) ?? []);

  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      api.updateTask(task.id, {
        name: name.trim(),
        description: description.trim(),
        intervalSeconds,
        colorFresh,
        colorOverdue,
        freezeColor,
        tags,
        folder: folder.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
      toast("Task saved", { tone: "success" });
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
        <Label>Tags</Label>
        <TagInput value={tags} onChange={setTags} />
      </div>

      <div className="space-y-2">
        <Label>Folder</Label>
        <FolderInput value={folder} onChange={setFolder} suggestions={folderSuggestions} />
      </div>

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
  // On a shared task, resolve each completion's author id to a name ("by X").
  const { data: members } = useQuery({
    queryKey: ["members", task.id],
    queryFn: () => api.listMembers(task.id),
    enabled: task.shared,
  });
  const names = useMemo(() => {
    const m = new Map<number, string>();
    for (const mem of members ?? []) m.set(mem.userId, mem.username);
    return m;
  }, [members]);

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
          <HistoryRow
            key={c.id}
            completion={c}
            author={task.shared && c.userId != null ? names.get(c.userId) : undefined}
            onChanged={invalidate}
          />
        ))}
      </div>
    </div>
  );
}

// HistoryRow shows one completion and lets you edit its time/note in place
// (PATCH /api/completions/{id}) or delete it. `author` (when set) names who
// logged it, shown on shared tasks.
function HistoryRow({
  completion: c,
  author,
  onChanged,
}: {
  completion: Completion;
  author?: string;
  onChanged: () => void;
}) {
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
        <p className="text-sm font-medium">
          {formatDateTime(c.completedAt)}
          {author && <span className="font-normal text-muted-foreground"> · by {author}</span>}
        </p>
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
  const toast = useToast();
  const archived = task.archivedAt != null;

  const mutation = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      onDeleted();
      toast("Task deleted", { tone: "success" });
    },
  });

  const archive = useMutation({
    mutationFn: () => (archived ? api.unarchiveTask(task.id) : api.archiveTask(task.id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onDeleted();
      toast(archived ? "Task restored" : "Task archived", { tone: "success" });
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
