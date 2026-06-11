import { useState } from "react";
import { Github, Info, RotateCcw, X } from "lucide-react";

import { DEMO } from "@/lib/demo";
import { DEMO_KEYS } from "@/lib/api.demo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * A small fixed notice shown only in the static GitHub Pages demo (`__DEMO__`).
 * It makes clear there's no server — changes live in this browser only — and
 * offers a one-click reset that wipes the local sandbox back to the seed data.
 *
 * Renders nothing in normal (server-backed) builds.
 */
export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (!DEMO || dismissed) return null;

  const reset = () => {
    try {
      for (const key of DEMO_KEYS) localStorage.removeItem(key);
    } catch {
      // storage unavailable — nothing to clear
    }
    window.location.reload();
  };

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 z-[60] max-w-[calc(100vw-2rem)] rounded-xl border bg-card/95 p-3 shadow-2xl backdrop-blur",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 text-xs">
          <p className="font-medium text-foreground">You're viewing the Taskrr demo</p>
          <p className="mt-0.5 text-muted-foreground">
            There's no server here — everything you do is saved only in this browser.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset demo
            </Button>
            <a
              href="https://github.com/unmaykr-a/taskrr"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-accent"
            >
              <Github className="h-3.5 w-3.5" /> Source
            </a>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
