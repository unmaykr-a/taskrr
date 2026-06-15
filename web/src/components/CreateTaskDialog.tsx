import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { api, type Task } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IntervalField } from "@/components/IntervalField";
import { TagInput } from "@/components/ui/TagInput";
import { FolderInput } from "@/components/ui/FolderInput";
import { folderNames } from "@/lib/folders";

/**
 * CreateTaskDialog owns the "new task" form. `trigger` lets callers supply their
 * own button (e.g. the sidebar vs. the empty-state), defaulting to a standard
 * "New task" button.
 */
export function CreateTaskDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const queryClient = useQueryClient();
  const folderSuggestions = folderNames(queryClient.getQueryData<Task[]>(["tasks"]) ?? []);

  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      api.createTask({
        name: name.trim(),
        description: description.trim() || undefined,
        intervalSeconds,
        tags,
        folder: folder.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setName("");
      setDescription("");
      setIntervalSeconds(null);
      setTags([]);
      setFolder("");
      setOpen(false);
      toast("Task created", { tone: "success" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> New task
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a task</DialogTitle>
          <DialogDescription>
            Something you do repeatedly and want to track the last time you did.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="task-name">Name</Label>
            <Input
              id="task-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Water the plants"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-description">Description (optional)</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any details worth remembering"
              rows={2}
            />
          </div>
          <IntervalField value={intervalSeconds} onChange={setIntervalSeconds} />
          <div className="space-y-2">
            <Label>Tags (optional)</Label>
            <TagInput value={tags} onChange={setTags} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-folder">Folder (optional)</Label>
            <FolderInput value={folder} onChange={setFolder} suggestions={folderSuggestions} />
          </div>
          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
