import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  KeyRound,
  Upload,
  Link2,
  Link2Off,
  Plus,
  Terminal,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

import { api, type APIToken, type ImportResult } from "@/lib/api";
import { parseCsv, type CsvTable } from "@/lib/csv";
import { CsvMapper } from "@/components/settings/CsvMapper";
import { clearStoredPreferences } from "@/lib/prefs";
import { useAuth } from "@/components/AuthProvider";
import { RemindersSection } from "@/components/settings/RemindersSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatDateTime } from "@/lib/time";

/** Account self-service: every signed-in user can change their own username + password. */
export function AccountSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState(user?.username ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Accounts created without a password (or OIDC-only) don't need the current one.
  const needsCurrent = user?.passwordSet ?? true;

  // Whether the instance offers OIDC at all — gates the "Connected sign-in" UI.
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });

  const unlink = useMutation({
    mutationFn: () => api.unlinkOIDC(),
    onSuccess: (updated) => queryClient.setQueryData(["me"], updated),
  });

  // Danger zone: both actions make the user re-type their own username to confirm.
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const name = (user?.username ?? "").toLowerCase();
  const wipeOk = wipeConfirm.trim().toLowerCase() === name && name !== "";
  const deleteOk = deleteConfirm.trim().toLowerCase() === name && name !== "";

  const wipe = useMutation({
    mutationFn: () => api.wipeMyData(wipeConfirm.trim()),
    onSuccess: () => {
      setWipeConfirm("");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast("Your tasks were deleted", { tone: "success" });
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteAccount(deleteConfirm.trim()),
    onSuccess: () => {
      // Mirror logout: drop the cached user (flips the app to the login screen)
      // and clear non-essential local state.
      clearStoredPreferences();
      queryClient.setQueryData(["me"], null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });

  const rename = useMutation({
    mutationFn: () => api.changeUsername(username.trim()),
    onSuccess: (updated) => {
      // Reflect the new name immediately and refresh the admin list if open.
      queryClient.setQueryData(["me"], updated);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast("Username updated", { tone: "success" });
    },
  });

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setErr(null);
      toast("Password updated", { tone: "success" });
    },
    onError: (e) => setErr((e as Error).message),
  });

  // Per-user opt-out for receiving shared tasks (shown only when sharing is on).
  const allowShares = useMutation({
    mutationFn: (allow: boolean) => api.setAllowShares(allow),
    onSuccess: (updated) => {
      queryClient.setQueryData(["me"], updated);
      toast("Sharing preference saved", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const submit = () => {
    setErr(null);
    if (next.length < 8) return setErr("Password must be at least 8 characters.");
    if (next !== confirm) return setErr("Passwords don't match.");
    change.mutate();
  };

  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Account</h3>
        <p className="text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user?.username}</span>
          {user?.role === "admin" && " · admin"}.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" /> Username
        </h4>
        <div className="flex gap-2">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="h-8"
          />
          <Button
            size="sm"
            disabled={rename.isPending || !username.trim() || username.trim() === user?.username}
            onClick={() => rename.mutate()}
          >
            {rename.isPending ? "Saving…" : "Rename"}
          </Button>
        </div>
        {rename.isError && <p className="text-xs text-destructive">{(rename.error as Error).message}</p>}
        {rename.isSuccess && <p className="text-xs text-emerald-500">Username updated.</p>}
      </section>

      {config?.tasksShareable && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Sharing
          </h4>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Let others share tasks with me
              <span className="block text-xs">When off, people can't send you tasks.</span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={user?.allowShares ?? true}
              disabled={allowShares.isPending}
              onChange={(e) => allowShares.mutate(e.target.checked)}
            />
          </label>
        </section>
      )}

      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" /> Change password
          {!needsCurrent && " (set one to enable username sign-in)"}
        </h4>
        {needsCurrent && (
          <Input
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-8"
          />
        )}
        <Input
          type="password"
          placeholder="New password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="h-8"
        />
        <Input
          type="password"
          placeholder="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-8"
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
        {change.isSuccess && <p className="text-xs text-emerald-500">Password updated.</p>}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={change.isPending || !next || !confirm || (needsCurrent && !current)}
            onClick={submit}
          >
            {change.isPending ? "Saving…" : "Change password"}
          </Button>
        </div>
      </section>

      {/* Connected sign-in: link or unlink a single sign-on (OIDC) identity.
          Only shown when the instance has OIDC configured, or the account is
          already linked (so a linked user can always unlink even if an admin
          later turns OIDC off). */}
      {(config?.oidc || user?.oidcLinked) && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" /> Connected sign-in
          </h4>
          {user?.oidcLinked ? (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Single sign-on</p>
                  <p className="text-xs text-muted-foreground">
                    Single sign-on is connected to this account.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 self-start sm:self-auto"
                  disabled={unlink.isPending || !user?.passwordSet}
                  onClick={() => unlink.mutate()}
                >
                  <Link2Off className="h-3.5 w-3.5" />
                  {unlink.isPending ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
              {!user?.passwordSet && (
                <p className="text-xs text-muted-foreground">
                  Set a password above first — otherwise you'd have no way to sign in.
                </p>
              )}
              {unlink.isError && (
                <p className="text-xs text-destructive">{(unlink.error as Error).message}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">
                Connect single sign-on so you can also sign in through your identity provider.
              </p>
              <Button size="sm" variant="outline" asChild>
                <a href="/api/auth/oidc/link">
                  <Link2 className="h-3.5 w-3.5" /> Connect SSO
                </a>
              </Button>
            </div>
          )}
        </section>
      )}

      <RemindersSection />

      <ExportSection />

      <APITokensSection />

      {/* Advanced: the irreversible self-service actions live here (each gated by
          re-typing the account's own username), under a "Danger zone" label.
          Collapsed by default so it's tucked away. */}
      <details className="group rounded-md border">
        <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-sm font-semibold list-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
          Advanced
        </summary>
        <div className="space-y-3 border-t p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> Danger zone
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Delete all your tasks and their history. Your account and settings stay.
            This can't be undone.
          </p>
          <div className="flex gap-2">
            <Input
              value={wipeConfirm}
              onChange={(e) => setWipeConfirm(e.target.value)}
              placeholder={`Type "${user?.username}" to confirm`}
              className="h-8"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={wipe.isPending || !wipeOk}
              onClick={() => wipe.mutate()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {wipe.isPending ? "Deleting…" : "Delete tasks"}
            </Button>
          </div>
          {wipe.isError && <p className="text-xs text-destructive">{(wipe.error as Error).message}</p>}
          {wipe.isSuccess && <p className="text-xs text-emerald-500">All your tasks were deleted.</p>}
        </div>

        {user?.protected ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            This is the primary admin account and can't be deleted.
          </p>
        ) : (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              Permanently delete your account and everything in it. You'll be signed
              out immediately. This can't be undone.
            </p>
            <div className="flex gap-2">
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={`Type "${user?.username}" to confirm`}
                className="h-8"
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={del.isPending || !deleteOk}
                onClick={() => del.mutate()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {del.isPending ? "Deleting…" : "Delete account"}
              </Button>
            </div>
            {del.isError && <p className="text-xs text-destructive">{(del.error as Error).message}</p>}
          </div>
        )}
        </div>
      </details>
    </div>
  );
}

// ExportSection: take your own data with you.
//
// Admin backups are whole-database and admin-only, so on a shared instance this
// is the only way an ordinary user can get their history out — and it's the one
// thing the demo can offer for real, since its data is already in the browser.
function ExportSection() {
  const toast = useToast();
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);

  const download = async (format: "json" | "csv") => {
    setBusy(format);
    try {
      const blob = await api.exportData(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `taskrr-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick — revoking synchronously can cancel the download
      // in some browsers before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Download className="h-4 w-4" /> Export your data
      </h3>
      <p className="text-xs text-muted-foreground">
        Every task you own or share, with its full history. JSON keeps the structure;
        CSV opens in a spreadsheet.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("json")}>
          {busy === "json" ? "Preparing…" : "Download JSON"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("csv")}>
          {busy === "csv" ? "Preparing…" : "Download CSV"}
        </Button>
      </div>

      <ImportControls />
    </section>
  );
}

// ImportControls: restore a JSON export.
//
// Merge is the default and the safe one. Replace wipes the account's tasks
// first, so it sits behind the same explicit confirmation as the other
// irreversible actions — and the file is read and checked before anything is
// deleted, so a bad file can never cost you what you already had.
function ImportControls() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [result, setResult] = useState<ImportResult | null>(null);
  // Set while a CSV is waiting for its columns to be matched up.
  const [csv, setCsv] = useState<{ table: CsvTable; fileName: string } | null>(null);

  const run = useMutation({
    mutationFn: ({ json, mode: m }: { json: string; mode: "merge" | "replace" }) => api.importData(json, m),
    onSuccess: (res) => {
      setResult(res);
      setCsv(null);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast(
        `Imported ${res.tasksCreated} ${res.tasksCreated === 1 ? "task" : "tasks"}`,
        { tone: "success" },
      );
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  // A CSV can't go straight to the server: it needs a mapping step first, so
  // it detours through CsvMapper and comes back as the same JSON document.
  const pick = async (file: File) => {
    const text = await file.text();
    const isCsv = /\.(csv|tsv|txt)$/i.test(file.name) || !text.trimStart().startsWith("{");
    if (isCsv) {
      const table = parseCsv(text);
      if (table.headers.length === 0) {
        toast("That file looks empty", { tone: "error" });
        return;
      }
      setCsv({ table, fileName: file.name });
      setResult(null);
      return;
    }
    await send(text);
  };

  const send = async (json: string) => {
    if (mode === "replace") {
      const ok = await confirm({
        title: "Replace everything?",
        description:
          "This deletes all of your current tasks and their history first, then restores the file. This can't be undone.",
        confirmText: "Delete and restore",
        destructive: true,
      });
      if (!ok) return;
    }
    run.mutate({ json, mode });
  };

  return (
    <div className="space-y-2 pt-1">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <Upload className="h-3.5 w-3.5" /> Restore from a file
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "merge" | "replace")}
          aria-label="Import mode"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="merge" className="bg-background">Add to my tasks</option>
          <option value="replace" className="bg-background">Replace everything</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,text/csv,.csv,.tsv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset first, so picking the same file twice still fires a change.
            e.target.value = "";
            if (file) void pick(file);
          }}
        />
        <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => fileRef.current?.click()}>
          {run.isPending ? "Importing…" : "Choose a file…"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A Taskrr JSON export restores as-is. A CSV from another tracker asks which column is which
        first.
      </p>

      {csv && (
        <CsvMapper
          table={csv.table}
          fileName={csv.fileName}
          busy={run.isPending}
          onCancel={() => setCsv(null)}
          onImport={(json) => void send(json)}
        />
      )}

      {result && (
        <div className="space-y-1 rounded-md border p-2 text-xs">
          <p className="text-foreground">
            Restored {result.tasksCreated} {result.tasksCreated === 1 ? "task" : "tasks"} and{" "}
            {result.completionsAdded} {result.completionsAdded === 1 ? "completion" : "completions"}
            {result.tasksDeleted > 0 && `, after removing ${result.tasksDeleted}`}.
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="text-muted-foreground">
                {result.skipped.length} {result.skipped.length === 1 ? "entry" : "entries"} couldn't be restored:
              </p>
              <ul className="max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-muted-foreground">
                {result.skipped.slice(0, 20).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// APITokensSection: bearer credentials for automation.
//
// The plaintext token exists only in this component's state, for as long as the
// panel is open after minting it — the server keeps a digest and will never show
// it again, so the copy affordance has to be right there.
function APITokensSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const enabled = config?.apiTokens ?? false;
  const { data: tokens } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: api.listAPITokens,
    enabled,
  });
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createAPIToken(name.trim() || "API token"),
    onSuccess: (t) => {
      setFresh(t.token);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => api.deleteAPIToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
      toast("Token revoked", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied", { tone: "success" });
    } catch {
      // Clipboard access needs a secure context, which a LAN instance on plain
      // HTTP won't have — the token stays selectable on screen either way.
      toast("Copy failed — select the token and copy it manually", { tone: "error" });
    }
  };

  if (!enabled) return null;

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Terminal className="h-4 w-4" /> API tokens
      </h3>
      <p className="text-xs text-muted-foreground">
        Log a task from a script, an NFC tag, or your home automation. A token reaches
        your tasks and history only — never the admin area or your password.
      </p>

      {fresh && (
        <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/10 p-2">
          <p className="text-xs font-medium">Copy this now — it isn't shown again.</p>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 select-all break-all rounded bg-background/60 px-1.5 py-1 text-[11px]">
              {fresh}
            </code>
            <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" aria-label="Copy token" onClick={() => copy(fresh)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="break-all text-[11px] text-muted-foreground">
            curl -H &quot;Authorization: Bearer {fresh.slice(0, 8)}…&quot; {window.location.origin}/api/tasks
          </p>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setFresh(null)}>
            Done
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Where will it live? e.g. kitchen tablet"
          className="min-w-0 flex-1 basis-48"
          onKeyDown={(e) => e.key === "Enter" && !create.isPending && create.mutate()}
        />
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus className="h-3.5 w-3.5" /> {create.isPending ? "Creating…" : "New token"}
        </Button>
      </div>

      {tokens && tokens.length > 0 && (
        <ul className="space-y-1">
          {tokens.map((t: APIToken) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm">{t.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {t.lastUsedAt ? `Last used ${formatDateTime(t.lastUsedAt)}` : "Never used"}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 hover:text-destructive"
                aria-label={`Revoke ${t.name}`}
                disabled={revoke.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Revoke token",
                    description: `Anything using "${t.name}" stops working immediately. This can't be undone.`,
                    confirmText: "Revoke",
                    destructive: true,
                  });
                  if (ok) revoke.mutate(t.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
