import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const LEAD_OPTIONS: { label: string; value: number }[] = [
  { label: "When it's due", value: 0 },
  { label: "1 hour before", value: 3600 },
  { label: "6 hours before", value: 21600 },
  { label: "1 day before", value: 86400 },
  { label: "3 days before", value: 259200 },
  { label: "1 week before", value: 604800 },
];

/** Reminders: deliver a webhook when one of your tasks comes due. */
export function RemindersSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["reminders"], queryFn: api.getReminders });

  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [leadSeconds, setLeadSeconds] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  // Seed the form once from the server.
  useEffect(() => {
    if (data && !hydrated) {
      setEnabled(data.enabled);
      setWebhookUrl(data.webhookUrl);
      setLeadSeconds(data.leadSeconds);
      setHydrated(true);
    }
  }, [data, hydrated]);

  const apply = (s: { enabled: boolean; webhookUrl: string; leadSeconds: number }) => {
    setEnabled(s.enabled);
    setWebhookUrl(s.webhookUrl);
    setLeadSeconds(s.leadSeconds);
  };

  const save = useMutation({
    mutationFn: () => api.putReminders({ enabled, webhookUrl: webhookUrl.trim(), leadSeconds }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["reminders"], updated);
      apply(updated); // reflect any server-side normalisation
    },
  });
  const test = useMutation({ mutationFn: () => api.testReminder(webhookUrl.trim()) });

  const canSave = !enabled || webhookUrl.trim() !== "";

  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Bell className="h-3.5 w-3.5" /> Reminders
      </h4>
      <div className="space-y-2 rounded-md border border-border/60 p-3">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Send a webhook when a task is due</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>
        <Input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://ntfy.sh/your-topic"
          autoComplete="off"
          className="h-8"
        />
        <p className="text-[11px] text-muted-foreground">
          Taskrr POSTs a JSON notification (title + message) to this URL. Works with ntfy, Apprise,
          Gotify, Discord/Slack webhooks, Home Assistant, and the like.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Notify</span>
          <select
            value={leadSeconds}
            onChange={(e) => setLeadSeconds(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {LEAD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-background">
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={save.isPending || !canSave} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={test.isPending || webhookUrl.trim() === ""}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Sending…" : "Send test"}
          </Button>
          {save.isSuccess && <span className="text-xs text-emerald-500">Saved.</span>}
          {save.isError && <span className="text-xs text-destructive">{(save.error as Error).message}</span>}
          {test.isSuccess && <span className="text-xs text-emerald-500">Test sent.</span>}
          {test.isError && <span className="text-xs text-destructive">{(test.error as Error).message}</span>}
        </div>
      </div>
    </section>
  );
}
