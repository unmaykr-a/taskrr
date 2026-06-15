import { useState } from "react";
import { Bug, RefreshCw, Sparkles } from "lucide-react";

import { api } from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { useAuth } from "@/components/AuthProvider";
import { compareVersions, CURRENT_VERSION, formatReleaseDate, type Release, RELEASES } from "@/lib/releases";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** ReleaseEntry renders one version: a tag, its date, and the change list with
 *  a sparkles (feature) or bug (fix) icon per line, plus an optional grey note.
 *  Shared by the changelog and what's-new dialogs. */
export function ReleaseEntry({ release }: { release: Release }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
          v{release.version}
        </span>
        <span className="text-xs text-muted-foreground">{formatReleaseDate(release.date)}</span>
      </div>
      <ul className="space-y-1.5">
        {release.changes.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {c.kind === "feature" ? (
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <Bug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            )}
            <span>
              {c.text}
              {c.note && <span className="text-muted-foreground"> - {c.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The full changelog: every release, newest first. Opened from the version label. */
export function ChangelogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  // The update check is an admin concern; regular users don't manage upgrades.
  const showUpdateCheck = !DEMO && user?.role === "admin";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Changelog</DialogTitle>
        </DialogHeader>
        <div className="-mr-2 max-h-[55vh] space-y-5 overflow-y-auto pr-2">
          {RELEASES.map((r) => (
            <ReleaseEntry key={r.version} release={r} />
          ))}
        </div>
        {showUpdateCheck && <UpdateCheck />}
      </DialogContent>
    </Dialog>
  );
}

// UpdateCheck reports whether a newer version has been released. It only checks
// and informs — there is no in-app update action.
function UpdateCheck() {
  const [state, setState] = useState<"idle" | "checking">("idle");
  const [result, setResult] = useState<string | null>(null);

  const check = async () => {
    setState("checking");
    setResult(null);
    try {
      const { latest } = await api.checkLatestVersion();
      if (!latest) {
        setResult("Couldn't check for updates right now.");
      } else if (compareVersions(latest, CURRENT_VERSION) > 0) {
        setResult(`Update available: v${latest} (you have v${CURRENT_VERSION}).`);
      } else {
        setResult(`You're on the latest version (v${CURRENT_VERSION}).`);
      }
    } catch {
      setResult("Couldn't check for updates right now.");
    } finally {
      setState("idle");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
      <Button variant="outline" size="sm" disabled={state === "checking"} onClick={check}>
        <RefreshCw className={state === "checking" ? "animate-spin" : undefined} />
        {state === "checking" ? "Checking…" : "Check for updates"}
      </Button>
      {result && <span className="text-muted-foreground">{result}</span>}
    </div>
  );
}
