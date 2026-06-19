import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { usePrefs } from "@/lib/prefs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// In-app confirm / prompt / alert dialogs, themed to match the rest of the app
// instead of the browser's native pop-ups. Call them via useConfirm(); each
// returns a Promise so call sites read like the blocking browser equivalents.
//
// A per-user preference (prefs.nativeDialogs) falls back to the real
// window.confirm/prompt/alert for anyone who prefers them.

interface BaseOptions {
  /** Heading. Falls back to a sensible default per kind. */
  title?: string;
  /** Body text. Newlines are preserved. */
  description?: string;
  /** Confirm button label (default "Confirm", or "OK" for alert). */
  confirmText?: string;
  /** Cancel button label (default "Cancel"). */
  cancelText?: string;
  /** Style the confirm button as destructive (for deletes etc.). */
  destructive?: boolean;
}

export type ConfirmOptions = BaseOptions;

export interface PromptOptions extends BaseOptions {
  defaultValue?: string;
  placeholder?: string;
  /** Input type, e.g. "text" (default) or "password". */
  inputType?: string;
}

export interface ConfirmApi {
  confirm: (opts?: ConfirmOptions) => Promise<boolean>;
  prompt: (opts?: PromptOptions) => Promise<string | null>;
  alert: (opts?: BaseOptions | string) => Promise<void>;
}

type Kind = "confirm" | "prompt" | "alert";

interface Request {
  id: number;
  kind: Kind;
  opts: PromptOptions;
  resolve: (value: boolean | string | null | void) => void;
}

const Ctx = createContext<ConfirmApi | null>(null);

/** Returns { confirm, prompt, alert }. Must be used under ConfirmProvider. */
export function useConfirm(): ConfirmApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

/** Flatten a dialog's title + body into the single string a native pop-up takes. */
function toText(opts: BaseOptions): string {
  return [opts.title, opts.description].filter(Boolean).join("\n\n");
}

function defaultTitle(kind: Kind): string {
  return kind === "alert" ? "Notice" : kind === "prompt" ? "Enter a value" : "Are you sure?";
}

let nextId = 1;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  // Read the latest preference at call time without re-creating the api callback.
  const nativeRef = useRef(prefs.nativeDialogs);
  nativeRef.current = prefs.nativeDialogs;

  const [queue, setQueue] = useState<Request[]>([]);
  const [value, setValue] = useState("");

  const enqueue = useCallback((kind: Kind, opts: PromptOptions) => {
    if (nativeRef.current) {
      // Native fallback: the browser's own (synchronous) dialogs.
      if (kind === "confirm") return Promise.resolve(window.confirm(toText(opts)));
      if (kind === "prompt") return Promise.resolve(window.prompt(toText(opts), opts.defaultValue ?? ""));
      window.alert(toText(opts));
      return Promise.resolve(undefined);
    }
    return new Promise<boolean | string | null | void>((resolve) => {
      const req: Request = { id: nextId++, kind, opts, resolve };
      setQueue((q) => {
        if (q.length === 0) setValue(opts.defaultValue ?? ""); // priming the input
        return [...q, req];
      });
    });
  }, []);

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: (opts = {}) => enqueue("confirm", opts) as Promise<boolean>,
      prompt: (opts = {}) => enqueue("prompt", opts) as Promise<string | null>,
      alert: (opts = {}) =>
        enqueue("alert", typeof opts === "string" ? { description: opts } : opts) as Promise<void>,
    }),
    [enqueue],
  );

  const active = queue[0];

  const finish = (result: boolean | string | null | void) => {
    if (!active) return;
    active.resolve(result);
    setQueue((q) => {
      const next = q.slice(1);
      if (next[0]) setValue(next[0].opts.defaultValue ?? "");
      return next;
    });
  };

  const onCancel = () =>
    finish(active?.kind === "prompt" ? null : active?.kind === "confirm" ? false : undefined);
  const onConfirm = () =>
    finish(active?.kind === "prompt" ? value : active?.kind === "confirm" ? true : undefined);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog open={!!active} onOpenChange={(open) => !open && onCancel()}>
        {active && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{active.opts.title ?? defaultTitle(active.kind)}</DialogTitle>
              {active.opts.description && (
                <DialogDescription className="whitespace-pre-line">
                  {active.opts.description}
                </DialogDescription>
              )}
            </DialogHeader>
            {active.kind === "prompt" && (
              <input
                autoFocus
                type={active.opts.inputType ?? "text"}
                value={value}
                placeholder={active.opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirm();
                  }
                }}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            <DialogFooter>
              {active.kind !== "alert" && (
                <Button variant="outline" onClick={onCancel}>
                  {active.opts.cancelText ?? "Cancel"}
                </Button>
              )}
              <Button
                variant={active.opts.destructive ? "destructive" : "default"}
                onClick={onConfirm}
              >
                {active.opts.confirmText ?? (active.kind === "alert" ? "OK" : "Confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}
