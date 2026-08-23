import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  Clock,
  Copy,
  Moon,
  Pin,
  PinOff,
  Settings2,
  SkipForward,
  Trash2,
  Zap,
} from "lucide-react";

import { api, type Task } from "@/lib/api";
import { isSnoozed, nextDue } from "@/lib/staleness";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { useTaskWindows } from "@/components/useTaskWindows";

/**
 * useTaskActions — the task verbs that aren't editing a field.
 *
 * The right-click menu and the Manage window offer overlapping sets of these,
 * and they have to behave identically wherever they're invoked (same
 * invalidations, same confirmations, same wording). Keeping them in one hook is
 * what makes that true by construction rather than by discipline.
 */

/** The snooze durations the menu offers, plus how to describe them. */
export const SNOOZE_PRESETS: { label: string; hours: number }[] = [
  { label: "1 hour", hours: 1 },
  { label: "Tomorrow", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
];

export function useTaskActions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();

  // Every one of these can change what the list shows and what the calendar and
  // activity chart contain, so they all refresh the same set.
  const refresh = (taskId?: number) => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
    if (taskId != null) queryClient.invalidateQueries({ queryKey: ["completions", taskId] });
  };

  const fail = (e: unknown) => toast((e as Error).message, { tone: "error" });

  /**
   * Undo, for a completion that was just created.
   *
   * Quick log is one tap on a dense grid and the wrong tap is easy; putting it
   * right otherwise means Manage → History → delete, which nobody does for a
   * stray log. Deleting the completion we just made restores exactly the state
   * before it, which is why this is the whole of "undo" — there is nothing else
   * a log changes.
   */
  const undoCompletion = (completionId: number, taskId: number) => ({
    label: "Undo",
    onSelect: () => {
      api
        .deleteCompletion(completionId)
        .then(() => {
          refresh(taskId);
          toast("Log undone");
        })
        .catch(fail);
    },
  });

  const quickLog = useMutation({
    mutationFn: (task: Task) => api.quickComplete(task.id),
    onSuccess: (completion, task) => {
      refresh(task.id);
      toast("Logged", { tone: "success", action: undoCompletion(completion.id, task.id) });
    },
    onError: fail,
  });

  const snooze = useMutation({
    mutationFn: ({ task, hours }: { task: Task; hours: number }) =>
      api.snoozeTask(task.id, new Date(Date.now() + hours * 3_600_000).toISOString()),
    onSuccess: (updated) => {
      refresh();
      const until = updated.snoozedUntil ? new Date(updated.snoozedUntil) : null;
      toast(until ? `Snoozed until ${until.toLocaleString()}` : "Snoozed", { tone: "success" });
    },
    onError: fail,
  });

  const snoozeUntil = useMutation({
    mutationFn: ({ task, until }: { task: Task; until: Date }) =>
      api.snoozeTask(task.id, until.toISOString()),
    onSuccess: () => {
      refresh();
      toast("Snoozed", { tone: "success" });
    },
    onError: fail,
  });

  const wake = useMutation({
    mutationFn: (task: Task) => api.snoozeTask(task.id, null),
    onSuccess: () => {
      refresh();
      toast("Snooze cleared", { tone: "success" });
    },
    onError: fail,
  });

  const skip = useMutation({
    mutationFn: (task: Task) => api.skipTask(task.id),
    onSuccess: (updated) => {
      refresh();
      const due = nextDue(updated);
      toast(due ? `Skipped — next due ${due.toLocaleDateString()}` : "Cycle skipped", { tone: "success" });
    },
    onError: fail,
  });

  const pin = useMutation({
    mutationFn: ({ task, pinned }: { task: Task; pinned: boolean }) => api.pinTask(task.id, pinned),
    onSuccess: (updated) => {
      refresh();
      toast(updated.pinned ? "Pinned to the top" : "Unpinned", { tone: "success" });
    },
    onError: fail,
  });

  const duplicate = useMutation({
    mutationFn: (task: Task) => api.duplicateTask(task.id),
    onSuccess: (copy) => {
      refresh();
      toast(`Created "${copy.name}"`, { tone: "success" });
    },
    onError: fail,
  });

  const archive = useMutation({
    mutationFn: ({ task, archived }: { task: Task; archived: boolean }) =>
      archived ? api.archiveTask(task.id) : api.unarchiveTask(task.id),
    onSuccess: (_d, { archived }) => {
      refresh();
      toast(archived ? "Archived" : "Restored", { tone: "success" });
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (task: Task) => api.deleteTask(task.id),
    onSuccess: () => {
      refresh();
      toast("Deleted", { tone: "success" });
    },
    onError: fail,
  });

  /**
   * Delete, behind a confirmation. Deleting is the one action here that can't
   * be undone, so it never happens on a single click — including from the
   * context menu, where a mis-aimed click is easiest.
   */
  const confirmDelete = async (task: Task) => {
    const ok = await confirm({
      title: `Delete "${task.name}"?`,
      description:
        task.completionCount > 0
          ? `This removes the task and its ${task.completionCount} logged ${
              task.completionCount === 1 ? "completion" : "completions"
            }. This can't be undone.`
          : "This removes the task. This can't be undone.",
      confirmText: "Delete",
      destructive: true,
    });
    if (ok) remove.mutate(task);
  };

  return { quickLog, snooze, snoozeUntil, wake, skip, pin, duplicate, archive, confirmDelete, undoCompletion };
}

/**
 * useTaskMenu — the right-click menu for a task, wherever it is right-clicked.
 *
 * Lives here rather than in TaskCard because the cards are no longer the only
 * place a task appears: the calendar's day list shows them too, and a menu that
 * offered a different set of actions depending on which list you found the task
 * in would be worse than no menu at all.
 *
 * Returns a builder rather than the entries themselves — ContextMenu calls it
 * on open, so labels ("Pin" vs "Unpin") reflect the task as it is now.
 */
export function useTaskMenu() {
  const actions = useTaskActions();
  const { openManage, openComplete } = useTaskWindows();
  const { user } = useAuth();

  return (task: Task) => (): ContextMenuEntry[] => {
    // Scheduling and structure belong to the owner; a member of a shared task
    // gets only the actions they're actually allowed to perform.
    const isOwner = user ? task.ownerId === user.id : true;
    const archived = task.archivedAt != null;
    const snoozed = isSnoozed(task);

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
}
