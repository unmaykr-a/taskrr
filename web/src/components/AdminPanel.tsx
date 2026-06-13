import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Trash2, UserPlus, X } from "lucide-react";

import { api, type SettingsPatch, type User } from "@/lib/api";
import { clearStoredPreferences } from "@/lib/prefs";
import { timeSince } from "@/lib/time";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * AdminPanel is the admin-only window body: registration controls + user
 * management (add / change role / reset password / delete). All actions go
 * through the /api/admin endpoints, which independently enforce admin rights.
 */
export function AdminPanel() {
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const lite = config?.lite ?? false;
  return (
    <div className="space-y-5">
      {/* Lite mode hides the multi-user surface (registration + adding accounts). */}
      {!lite && (
        <>
          <RegistrationSettings />
          <hr className="border-border/60" />
        </>
      )}
      <OIDCSettings />
      <hr className="border-border/60" />
      <PendingUsers />
      {!lite && <Users />}
      <hr className="border-border/60" />
      <SessionsSection />
      <hr className="border-border/60" />
      <MergeAccounts />
      <hr className="border-border/60" />
      <AdvancedSettings />
      <hr className="border-border/60" />
      <LogsSection />
    </div>
  );
}

/** Logs: a live tail of the in-memory server/access log ring, in a collapsible
 *  section (like Advanced). Polls only while expanded and "Live" is on, and
 *  auto-scrolls to the newest line. */
function LogsSection() {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(true);
  const { data: logs } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.listLogs(0),
    enabled: open, // don't fetch/poll while collapsed
    refetchInterval: open && live ? 4000 : false,
  });
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep the view pinned to the newest line while tailing.
  useEffect(() => {
    if (open && live && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [logs, live, open]);

  return (
    <details
      className="rounded-lg border"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">Logs</summary>
      <div className="space-y-2 border-t p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Recent server and access logs, kept in memory since the last restart.
          </p>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Live
          </label>
        </div>
        <div
          ref={boxRef}
          className="h-64 overflow-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed"
        >
          {logs?.length === 0 && <p className="text-muted-foreground">No log lines yet.</p>}
          {logs?.map((e) => (
            <div key={e.seq} className="whitespace-pre-wrap break-all text-muted-foreground">
              {e.text}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

const MERGE_SELECT = "h-7 rounded border border-input bg-transparent px-1.5 text-xs disabled:opacity-50";

/** Active sessions: who's signed in, when they were last active, and a control
 *  to sign a user out on all their devices. Refreshes while the panel is open. */
function SessionsSection() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: sessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: api.listSessions,
    // Fetch once so the collapsed summary can show a count, but only poll while open.
    refetchInterval: open ? 30_000 : false,
  });
  const terminate = useMutation({
    mutationFn: (userId: number) => api.terminateSessions(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  return (
    <details className="rounded-lg border" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">
        Active sessions
        {sessions && sessions.length > 0 && (
          <span className="ml-1.5 font-normal text-muted-foreground">{sessions.length}</span>
        )}
      </summary>
      <div className="space-y-2 border-t p-3">
        <p className="text-[11px] text-muted-foreground">
          Who's signed in and when they last opened the site. "Terminate" signs a
          user out on every device.
        </p>
        {sessions?.length === 0 && <p className="text-xs text-muted-foreground">No active sessions.</p>}
        <div className="space-y-1.5">
          {sessions?.map((s) => {
            // The primary admin can't be signed out by another admin.
            const locked = s.protected && !me?.protected;
            const isSelf = s.userId === me?.id;
            return (
              <div
                key={s.userId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.username}</span>
                  {s.role === "admin" && (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">admin</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="text-xs text-muted-foreground"
                    title={`Last opened ${new Date(s.lastSeen).toLocaleString()}`}
                  >
                    {timeSince(s.lastSeen)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s.sessions} {s.sessions === 1 ? "session" : "sessions"}
                  </span>
                  <button
                    type="button"
                    onClick={() => terminate.mutate(s.userId)}
                    disabled={locked || terminate.isPending}
                    title={
                      locked
                        ? "Primary admin — protected from other admins"
                        : isSelf
                          ? "This signs you out too"
                          : "Sign out on all devices"
                    }
                    className="whitespace-nowrap text-xs text-destructive hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {isSelf ? "Sign out" : "Terminate"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {terminate.isError && <p className="text-xs text-destructive">{(terminate.error as Error).message}</p>}
      </div>
    </details>
  );
}

/** Merge accounts: fold one account into another (e.g. an OIDC-provisioned
 *  account into a local one), moving data + the OIDC link, then deleting it. */
function MergeAccounts() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const [sourceId, setSourceId] = useState<number | "">("");
  const [targetId, setTargetId] = useState<number | "">("");
  const [moveData, setMoveData] = useState(true);
  const [keepUsername, setKeepUsername] = useState<"target" | "source">("target");

  const source = users?.find((u) => u.id === sourceId);
  const target = users?.find((u) => u.id === targetId);

  const merge = useMutation({
    mutationFn: () =>
      api.mergeUsers({
        sourceId: sourceId as number,
        targetId: targetId as number,
        moveData,
        newUsername: keepUsername === "source" ? source?.username : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(); // users + tasks/activity may have moved
      setSourceId("");
      setTargetId("");
    },
  });

  if (!users || users.length < 2) return null;
  // The source is deleted, so it can't be you or the protected primary admin.
  const sourceOptions = users.filter((u) => u.id !== me?.id && !u.protected);
  // The target can't be the protected primary admin either — a merge would graft
  // the source's OIDC identity onto it (the server rejects this too).
  const targetOptions = users.filter((u) => u.id !== sourceId && !u.protected);
  const ready = source && target && source.id !== target.id;

  const confirmMerge = () => {
    if (!ready) return;
    const kept = keepUsername === "source" ? source!.username : target!.username;
    const dataMsg = moveData ? `move "${source!.username}"'s tasks into "${target!.username}"` : `discard "${source!.username}"'s tasks`;
    if (
      window.confirm(
        `Merge "${source!.username}" into "${target!.username}"?\n\nThis will ${dataMsg}, move its sign-in ` +
          `(including any OIDC link) to "${target!.username}", keep the username "${kept}", and DELETE ` +
          `"${source!.username}". This can't be undone.`,
      )
    ) {
      merge.mutate();
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Merge accounts</h3>
      <p className="text-xs text-muted-foreground">
        Fold one account into another — e.g. an OIDC-provisioned account into a local one, so either sign-in
        reaches the same account.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Merge</span>
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : "")}
          className={MERGE_SELECT}
        >
          <option value="" className="bg-background">account…</option>
          {sourceOptions.map((u) => (
            <option key={u.id} value={u.id} className="bg-background">{u.username}</option>
          ))}
        </select>
        <span className="text-muted-foreground">into</span>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : "")}
          className={MERGE_SELECT}
        >
          <option value="" className="bg-background">account…</option>
          {targetOptions.map((u) => (
            <option key={u.id} value={u.id} className="bg-background">{u.username}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Move the merged account's tasks over</span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={moveData}
          onChange={(e) => setMoveData(e.target.checked)}
        />
      </label>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Keep username:</span>
        <select
          value={keepUsername}
          onChange={(e) => setKeepUsername(e.target.value as "target" | "source")}
          className={MERGE_SELECT}
          disabled={!ready}
        >
          <option value="target" className="bg-background">{target?.username ?? "kept account"}</option>
          <option value="source" className="bg-background">{source?.username ?? "merged account"}</option>
        </select>
      </div>
      {/* An account holds one OIDC link, so when both sides have one the
          merged account's identity is dropped — warn before the confirm. */}
      {ready && source?.oidcLinked && target?.oidcLinked && (
        <p className="text-xs text-amber-500">
          Both accounts have an OIDC identity. "{target?.username}" keeps its own; "{source?.username}"'s
          OIDC sign-in will no longer work after the merge.
        </p>
      )}
      {merge.isError && <p className="text-xs text-destructive">{(merge.error as Error).message}</p>}
      {merge.isSuccess && <p className="text-xs text-emerald-500">Accounts merged.</p>}
      <Button
        variant="outline"
        size="sm"
        className="border-destructive/50 text-destructive hover:bg-destructive/10"
        disabled={merge.isPending || !ready}
        onClick={confirmMerge}
      >
        {merge.isPending ? "Merging…" : "Merge"}
      </Button>
    </section>
  );
}

/** Backups: create / download / delete snapshots, and restore from one (or an
 *  uploaded .db) — which restarts the server. */
function BackupsSection() {
  const queryClient = useQueryClient();
  const { data: backups } = useQuery({ queryKey: ["backups"], queryFn: api.listBackups });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["backups"] });
  const create = useMutation({ mutationFn: () => api.createBackup(), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (name: string) => api.deleteBackup(name), onSuccess: invalidate });

  const [restarting, setRestarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // After a restore, the server restarts; reload so we re-authenticate against
  // the restored database.
  const onRestoreStarted = () => {
    setErr(null);
    setRestarting(true);
    setTimeout(() => window.location.reload(), 6000);
  };
  const restoreExisting = useMutation({
    mutationFn: (name: string) => api.restoreBackup(name),
    onSuccess: onRestoreStarted,
    onError: (e) => setErr((e as Error).message),
  });
  const restoreUpload = useMutation({
    mutationFn: (file: File) => api.restoreUpload(file),
    onSuccess: onRestoreStarted,
    onError: (e) => setErr((e as Error).message),
  });

  const confirmRestore = (label: string, run: () => void) => {
    if (
      window.confirm(
        `Restore from ${label}?\n\nThis REPLACES all current data with the backup and restarts the server. ` +
          `A safety backup of the current data is taken first. Everyone is signed out.\n\nContinue?`,
      )
    ) {
      run();
    }
  };

  if (restarting) {
    return (
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Backups</h4>
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
          <p className="font-medium">Restoring…</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The server is restarting with the restored database. This page will reload in a few seconds.
          </p>
        </div>
      </section>
    );
  }

  const busy = restoreExisting.isPending || restoreUpload.isPending;

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Backups</h4>
      <p className="text-[11px] text-muted-foreground">
        A complete database snapshot saved in <code>data/backups</code>. Restoring replaces all data and
        restarts the server (a safety backup is taken first).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Backing up…" : "Create backup"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Restore from file…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".db,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) confirmRestore(`uploaded file "${f.name}"`, () => restoreUpload.mutate(f));
          }}
        />
      </div>
      {create.isError && <p className="text-xs text-destructive">{(create.error as Error).message}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
      {backups && backups.length > 0 && (
        <div className="space-y-1">
          {backups.map((b) => (
            <div key={b.name} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
              <span className="shrink-0 text-muted-foreground">{Math.max(1, Math.round(b.size / 1024))} KB</span>
              <a href={api.backupURL(b.name)} download className="shrink-0 text-primary hover:underline">
                download
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => confirmRestore(b.name, () => restoreExisting.mutate(b.name))}
                className="shrink-0 text-primary hover:underline disabled:opacity-50"
              >
                restore
              </button>
              <button
                type="button"
                aria-label={`Delete backup ${b.name}`}
                disabled={del.isPending}
                onClick={() => {
                  if (window.confirm(`Delete backup ${b.name}? This can't be undone.`)) del.mutate(b.name);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Advanced: backups + a danger zone of irreversible, instance-wide deletions. */
function AdvancedSettings() {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const wipe = useMutation({
    mutationFn: (opts: { tasks?: boolean; users?: boolean; everything?: boolean }) => api.adminWipe(opts),
    onSuccess: (res, vars) => {
      if (vars.everything) {
        // The server forgot everything (settings, prefs, themes) — drop the
        // browser's copies too and start clean, like a first visit.
        clearStoredPreferences();
        window.location.reload();
        return;
      }
      queryClient.invalidateQueries();
      setMsg(vars.users ? `Done — removed ${res.deletedUsers} user(s) and their data.` : "Done — all tasks wiped.");
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const confirmWipe = (opts: { tasks?: boolean; users?: boolean; everything?: boolean }, label: string) => {
    if (window.confirm(`This permanently deletes ${label}.\n\nThis cannot be undone. Continue?`)) {
      setMsg(null);
      wipe.mutate(opts);
    }
  };
  const danger = "border-destructive/50 text-destructive hover:bg-destructive/10";

  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">Advanced</summary>
      <div className="space-y-4 border-t p-3">
        <BackupsSection />
        <hr className="border-destructive/30" />
        <p className="text-xs font-semibold text-destructive">Danger zone</p>
        <p className="text-xs text-muted-foreground">
          Irreversible. Your own admin account is always kept.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className={danger}
            disabled={wipe.isPending}
            onClick={() => confirmWipe({ tasks: true }, "ALL tasks and history for every user")}
          >
            Wipe all tasks
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={danger}
            disabled={wipe.isPending}
            onClick={() => confirmWipe({ users: true }, "ALL non-admin users and their data")}
          >
            Delete non-admin users
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={danger}
            disabled={wipe.isPending}
            onClick={() =>
              confirmWipe(
                { everything: true },
                "EVERYTHING — every other account, all tasks and history, all settings (including OIDC), preferences and reminders. Only your admin username and password are kept",
              )
            }
          >
            Wipe everything
          </Button>
        </div>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      </div>
    </details>
  );
}

function RegistrationSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => api.putSettings(patch),
    onSuccess: (next) => queryClient.setQueryData(["settings"], next),
  });

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Registration</h3>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Allow local sign-ups (Register tab)</span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={data?.reg_local ?? false}
          onChange={(e) => save.mutate({ reg_local: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Auto-create accounts on OIDC sign-in</span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={data?.reg_oidc ?? true}
          onChange={(e) => save.mutate({ reg_oidc: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          Require admin approval for sign-ups
          <span className="block text-xs">New local accounts wait in a queue until you approve them</span>
        </span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={data?.reg_approval ?? false}
          onChange={(e) => save.mutate({ reg_approval: e.target.checked })}
        />
      </label>
    </section>
  );
}

/** Accounts awaiting approval (shown only when there are any). */
function PendingUsers() {
  const queryClient = useQueryClient();
  const { data: pending } = useQuery({
    queryKey: ["pending-users"],
    queryFn: api.listPending,
    refetchInterval: 15_000,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-users"] });
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };
  const approve = useMutation({
    mutationFn: (v: { id: number; role: "admin" | "user" }) => api.approveUser(v.id, v.role),
    onSuccess: invalidate,
  });
  const deny = useMutation({ mutationFn: (id: number) => api.adminDeleteUser(id), onSuccess: invalidate });

  if (!pending || pending.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">
        Pending approval <span className="text-xs text-amber-500">({pending.length})</span>
      </h3>
      <div className="space-y-1.5">
        {pending.map((u) => (
          <PendingRow
            key={u.id}
            user={u}
            onApprove={(role) => approve.mutate({ id: u.id, role })}
            onDeny={() => deny.mutate(u.id)}
            busy={approve.isPending || deny.isPending}
          />
        ))}
      </div>
    </section>
  );
}

function PendingRow({
  user,
  onApprove,
  onDeny,
  busy,
}: {
  user: User;
  onApprove: (role: "admin" | "user") => void;
  onDeny: () => void;
  busy: boolean;
}) {
  const [role, setRole] = useState<"admin" | "user">("user");
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 px-2.5 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{user.username}</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "admin" | "user")}
        className="h-7 rounded border border-input bg-transparent px-1 text-xs"
      >
        <option value="user" className="bg-background">user</option>
        <option value="admin" className="bg-background">admin</option>
      </select>
      <Button size="sm" disabled={busy} onClick={() => onApprove(role)}>
        Approve
      </Button>
      <button
        type="button"
        disabled={busy}
        onClick={onDeny}
        className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
      >
        Deny
      </button>
    </div>
  );
}

function OIDCSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [form, setForm] = useState<SettingsPatch>({});
  const [secret, setSecret] = useState("");

  // Saves the form fields plus any extra patch (the link-by-username toggle
  // saves itself immediately, like the Registration checkboxes).
  const save = useMutation({
    mutationFn: (extra: SettingsPatch | undefined) =>
      api.putSettings({ ...form, ...(secret ? { oidc_client_secret: secret } : {}), ...(extra ?? {}) }),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      setForm({});
      setSecret("");
    },
  });

  // The visible value is the local edit (if any) else the saved value.
  const val = (k: keyof SettingsPatch & string) =>
    (form as Record<string, string>)[k] ??
    ((data as unknown as Record<string, unknown>)?.[k] as string) ??
    "";
  const field = (k: keyof SettingsPatch & string, label: string, placeholder?: string) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={val(k)}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
        className="h-8"
      />
    </div>
  );

  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold list-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
          Single sign-on (OIDC)
        </span>
        <span className={data?.oidc_enabled ? "text-xs font-normal text-emerald-400" : "text-xs font-normal text-muted-foreground"}>
          {data?.oidc_enabled ? "enabled" : "not configured"}
        </span>
      </summary>
      <div className="space-y-2 border-t p-3">
      {field("oidc_issuer", "Issuer URL", "https://auth.example.com/application/o/taskrr/")}
      <div className="grid grid-cols-2 gap-2">
        {field("oidc_client_id", "Client ID")}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Client secret</Label>
          <Input
            type="password"
            value={secret}
            placeholder={data?.oidc_client_secret_set ? "•••••• (set)" : ""}
            onChange={(e) => setSecret(e.target.value)}
            className="h-8"
          />
        </div>
      </div>
      {field("oidc_redirect_url", "Redirect URL (optional)", "auto-detected from this site")}
      <p className="text-[11px] text-muted-foreground">
        Leave blank to auto-detect (<code>https://&lt;this-site&gt;/api/auth/oidc/callback</code>). Whatever
        you use must be listed in the provider's allowed redirect URIs.
      </p>
      {field("oidc_admin_group", "Admin group (optional)", "taskrr-admins")}
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          Link by username on first sign-in
          <span className="block text-xs">
            Off (recommended): a first SSO sign-in matching an existing local username is refused —
            users connect SSO themselves from Settings. On: it attaches to that account automatically.
          </span>
        </span>
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-primary"
          checked={data?.oidc_link_username ?? false}
          onChange={(e) => save.mutate({ oidc_link_username: e.target.checked })}
        />
      </label>
      {data?.oidc_enabled && (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            SSO sign-in only
            <span className="block text-xs">
              Hides local sign-in; everyone uses single sign-on. The primary admin can
              still sign in with its password, so a provider outage can't lock you out.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-primary"
            checked={data?.oidc_only ?? false}
            onChange={(e) => save.mutate({ oidc_only: e.target.checked })}
          />
        </label>
      )}
      <div className="flex justify-end">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? "Saving…" : "Save OIDC"}
        </Button>
      </div>
      {save.isError && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
      </div>
    </details>
  );
}

function Users() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  const create = useMutation({
    mutationFn: () => api.adminCreateUser({ username: name.trim(), password: pw, role }),
    onSuccess: () => {
      setName("");
      setPw("");
      setRole("user");
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: number; role?: "admin" | "user"; password?: string }) =>
      api.adminUpdateUser(v.id, { role: v.role, password: v.password }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.adminDeleteUser(id),
    onSuccess: invalidate,
  });

  const resetPassword = (u: User) => {
    const next = window.prompt(`New password for ${u.username} (min 8 chars):`);
    if (next) update.mutate({ id: u.id, password: next });
  };

  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">
        Users
        {users && users.length > 0 && (
          <span className="ml-1.5 font-normal text-muted-foreground">{users.length}</span>
        )}
      </summary>
      <div className="space-y-3 border-t p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="space-y-2 rounded-lg border p-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Username</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Password (optional)</Label>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-8" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Leave the password blank to let the user set their own on first sign-in.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "user")}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="user" className="bg-background">user</option>
            <option value="admin" className="bg-background">admin</option>
          </select>
          <Button type="submit" size="sm" className="shrink-0" disabled={create.isPending || !name.trim()}>
            <UserPlus /> Add user
          </Button>
        </div>
        {create.isError && <p className="text-xs text-destructive">{(create.error as Error).message}</p>}
      </form>

      <div className="space-y-1.5">
        {users?.map((u) => {
          // The primary admin's controls are locked for *other* admins.
          const locked = u.protected && !me?.protected;
          const isSelf = u.id === me?.id;
          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border px-2.5 py-1.5 text-sm"
            >
              {/* Name + badges grow and share the first line; the controls cluster
                  stays together and wraps to its own line on narrow widths. */}
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{u.username}</span>
                {u.protected && (
                  <span
                    className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
                    title="Primary admin — protected from changes by other admins"
                  >
                    primary
                  </span>
                )}
                {!u.passwordSet && !u.oidcLinked && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500" title="No password set yet — the user sets it on first sign-in">
                    unclaimed
                  </span>
                )}
                {u.oidcLinked && (
                  <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-500" title="Linked to an OIDC identity">
                    oidc
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={u.role}
                  disabled={isSelf || locked}
                  onChange={(e) => update.mutate({ id: u.id, role: e.target.value as "admin" | "user" })}
                  className="h-7 rounded border border-input bg-transparent px-1 text-xs disabled:opacity-50"
                >
                  <option value="user" className="bg-background">user</option>
                  <option value="admin" className="bg-background">admin</option>
                </select>
                <button
                  type="button"
                  onClick={() => resetPassword(u)}
                  disabled={locked}
                  className="whitespace-nowrap text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                >
                  reset pw
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate(u.id)}
                  disabled={isSelf || locked}
                  aria-label={`Delete ${u.username}`}
                  className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {(update.isError || remove.isError) && (
        <p className="text-xs text-destructive">
          {((update.error || remove.error) as Error)?.message}
        </p>
      )}
      </div>
    </details>
  );
}
