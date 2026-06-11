import type { Task } from "@/lib/api";
import { CompleteTaskPanel } from "@/components/CompleteTaskDialog";
import { ManageTaskPanel } from "@/components/ManageTaskDialog";
import { useWindows } from "@/components/windows/WindowManager";

/**
 * useTaskWindows centralises opening a task's floating windows so every entry
 * point (the card buttons, the calendar) behaves identically: one window per
 * task id, re-focused if already open. Manage shows edit/history/delete;
 * Complete is the advanced (time + note) log.
 */
export function useTaskWindows() {
  const windows = useWindows();

  const openManage = (task: Task) => {
    const id = `manage-${task.id}`;
    windows.open({
      id,
      title: `Manage “${task.name}”`,
      content: <ManageTaskPanel task={task} onClose={() => windows.close(id)} />,
    });
  };

  const openComplete = (task: Task) => {
    const id = `complete-${task.id}`;
    windows.open({
      id,
      title: `Log “${task.name}”`,
      content: <CompleteTaskPanel task={task} onClose={() => windows.close(id)} />,
    });
  };

  return { openManage, openComplete };
}
