import { useEffect, useState } from "react";

import { CURRENT_VERSION, type Release, releasesSince } from "@/lib/releases";
import { ReleaseEntry } from "@/components/ChangelogDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Per-device record of the last version this browser saw the app at.
const SEEN_KEY = "taskrr-seen-version";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(v: string) {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    // storage unavailable — the dialog just won't suppress next time
  }
}

/**
 * WhatsNew shows a one-off dialog after the app updates: the changes since the
 * version this browser last saw, with a single close. First-ever visit records
 * the current version silently (nothing to announce). Renders nothing otherwise.
 */
export function WhatsNew() {
  const [updates, setUpdates] = useState<Release[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = readSeen();
    if (!seen) {
      writeSeen(CURRENT_VERSION);
      return;
    }
    if (seen === CURRENT_VERSION) return;
    const since = releasesSince(seen);
    if (since.length === 0) {
      writeSeen(CURRENT_VERSION); // moved versions but nothing recorded between
      return;
    }
    setUpdates(since);
    setOpen(true);
  }, []);

  const close = () => {
    writeSeen(CURRENT_VERSION);
    setOpen(false);
  };

  if (updates.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What's new in v{CURRENT_VERSION}</DialogTitle>
        </DialogHeader>
        <div className="-mr-2 max-h-[60vh] space-y-5 overflow-y-auto pr-2">
          {updates.map((r) => (
            <ReleaseEntry key={r.version} release={r} />
          ))}
        </div>
        <DialogFooter>
          <Button onClick={close}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
