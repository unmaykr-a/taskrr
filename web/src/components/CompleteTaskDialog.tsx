import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";

import { api, type Task } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/DateTimePicker";

/**
 * CompleteTaskPanel is the "advanced log" surface — pick a time and add a
 * note — rendered as the body of a floating window so it can sit alongside other
 * task windows. `onClose` closes the owning window after a successful log.
 */
export function CompleteTaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(() => new Date());
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      api.completeTask(task.id, {
        note: note.trim() || undefined,
        completedAt: when.toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["completions", task.id] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      onClose();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label>When</Label>
        <DateTimePicker value={when} onChange={setWhen} max={new Date()} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={noteId}>Note (optional)</Label>
        <Textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. used the new filter"
          rows={3}
        />
      </div>
      {mutation.isError && (
        <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending}>
          <Check /> {mutation.isPending ? "Logging…" : "Log it"}
        </Button>
      </div>
    </form>
  );
}
