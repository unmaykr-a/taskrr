import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type Task } from "@/lib/api";
import { nextDue } from "@/lib/staleness";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

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

  const quickLog = useMutation({
    mutationFn: (task: Task) => api.quickComplete(task.id),
    onSuccess: (_d, task) => {
      refresh(task.id);
      toast("Logged", { tone: "success" });
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

  return { quickLog, snooze, snoozeUntil, wake, skip, pin, duplicate, archive, confirmDelete };
}
