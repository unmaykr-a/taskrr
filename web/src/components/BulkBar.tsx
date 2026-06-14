import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, CheckCheck, Trash2, X } from "lucide-react";

import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/button";

type BulkAction = "done" | "archive" | "unarchive" | "delete";

/**
 * BulkBar is the floating action bar shown while tasks are multi-selected. It
 * runs the chosen action across every selected id (client-side fan-out over the
 * existing endpoints — fine for a self-hosted, small-N tool) and refreshes the
 * affected queries. Delete asks for confirmation first.
 */
export function BulkBar({
  ids,
  archivedView,
  onClear,
}: {
  ids: number[];
  archivedView: boolean;
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const { prefs } = usePrefs();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = useMutation({
    mutationFn: async (action: BulkAction) => {
      if (action === "done") await Promise.all(ids.map((id) => api.quickComplete(id)));
      else if (action === "archive") await Promise.all(ids.map((id) => api.archiveTask(id)));
      else if (action === "unarchive") await Promise.all(ids.map((id) => api.unarchiveTask(id)));
      else await Promise.all(ids.map((id) => api.deleteTask(id)));
    },
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      setConfirmDelete(false);
      onClear();
      const labels: Record<BulkAction, string> = {
        done: "Logged",
        archive: "Archived",
        unarchive: "Restored",
        delete: "Deleted",
      };
      toast(`${labels[action]} ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`, { tone: "success" });
    },
  });

  const busy = run.isPending;

  return (
    // slide-in-from-left-1/2 keeps the enter keyframe's x at -50% so the rise
    // from the bottom doesn't fight the -translate-x-1/2 centering.
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-[47] flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card/95 px-2 py-1.5 shadow-xl backdrop-blur",
        prefs.animViews && "animate-in fade-in-0 slide-in-from-left-1/2 slide-in-from-bottom-4 duration-300",
      )}
    >
      <span className="px-2 text-sm font-medium tabular-nums">{ids.length} selected</span>

      {confirmDelete ? (
        <>
          <span className="text-sm text-muted-foreground">Delete {ids.length}?</span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => run.mutate("delete")}>
            {busy ? "Deleting…" : "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
            No
          </Button>
        </>
      ) : (
        <>
          {!archivedView && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run.mutate("done")}>
              <CheckCheck /> Done
            </Button>
          )}
          {archivedView ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run.mutate("unarchive")}>
              <ArchiveRestore /> Restore
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run.mutate("archive")}>
              <Archive /> Archive
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Clear selection" onClick={onClear}>
            <X />
          </Button>
        </>
      )}
    </div>
  );
}
