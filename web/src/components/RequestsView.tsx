import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderTree, Inbox, X } from "lucide-react";

import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * RequestsView is the body of the "Requests" sidebar view: the current user's
 * pending incoming invitations, each acceptable or declinable.
 *
 * Two kinds arrive here — a single task, or a whole folder. A folder invite says
 * how many tasks it currently covers, because accepting one is a much bigger
 * decision than accepting a task and shouldn't look identical to it.
 */
export function RequestsView({ animate = true }: { animate?: boolean }) {
  const queryClient = useQueryClient();
  const { data: requests, isLoading } = useQuery({
    queryKey: ["incoming-shares"],
    queryFn: api.listIncomingShares,
  });
  const { data: folderInvites, isLoading: loadingFolders } = useQuery({
    queryKey: ["folder-invites"],
    queryFn: api.listFolderInvites,
  });

  const respond = useMutation({
    mutationFn: ({ taskId, accept }: { taskId: number; accept: boolean }) =>
      api.respondShare(taskId, accept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incoming-shares"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });

  const respondFolder = useMutation({
    mutationFn: ({ folder, ownerId, accept }: { folder: string; ownerId: number; accept: boolean }) =>
      api.respondFolderShare(folder, ownerId, accept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folder-invites"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });

  if (isLoading || loadingFolders) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const folders = folderInvites ?? [];
  if ((!requests || requests.length === 0) && folders.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center",
          animate && "animate-in fade-in-0 zoom-in-95 duration-300",
        )}
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-base font-semibold">No requests</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          When someone shares a task or a folder with you, it'll appear here to accept or decline.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", animate && "animate-in fade-in-0 duration-300")}>
      {folders.map((req) => (
        <div
          key={`${req.ownerId}:${req.folder}`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
              {req.folder}
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-secondary-foreground">
                folder
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {req.taskCount} {req.taskCount === 1 ? "task" : "tasks"} from {req.ownerName} · anything
              added later is included · {formatDateTime(req.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={respondFolder.isPending}
              onClick={() => respondFolder.mutate({ folder: req.folder, ownerId: req.ownerId, accept: false })}
            >
              <X /> Decline
            </Button>
            <Button
              size="sm"
              disabled={respondFolder.isPending}
              onClick={() => respondFolder.mutate({ folder: req.folder, ownerId: req.ownerId, accept: true })}
            >
              <Check /> Accept
            </Button>
          </div>
        </div>
      ))}

      {(requests ?? []).map((req) => (
        <div
          key={req.taskId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">{req.taskName}</p>
            <p className="text-xs text-muted-foreground">
              Shared by {req.ownerName} · {formatDateTime(req.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ taskId: req.taskId, accept: false })}
            >
              <X /> Decline
            </Button>
            <Button
              size="sm"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ taskId: req.taskId, accept: true })}
            >
              <Check /> Accept
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
