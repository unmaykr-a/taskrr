import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** One row in the help overlay: the key (or keys) and what it does. */
export interface ShortcutHelp {
  keys: string[];
  label: string;
}

/**
 * ShortcutsDialog is the "?" overlay listing the global shortcuts.
 *
 * It's the only discovery surface for them, so it's worth having even though
 * the bindings are simple — nobody guesses that "3" jumps to Overdue.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: ShortcutHelp[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys, no modifiers — and never while you're typing in a field.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
              <span className="min-w-0 text-muted-foreground">{s.label}</span>
              <span className="flex shrink-0 gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 font-app text-xs text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Turn these off in Settings → Preferences.
        </p>
      </DialogContent>
    </Dialog>
  );
}
