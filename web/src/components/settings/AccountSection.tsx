import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Link2, Link2Off, Trash2, UserRound } from "lucide-react";

import { api } from "@/lib/api";
import { clearStoredPreferences } from "@/lib/prefs";
import { useAuth } from "@/components/AuthProvider";
import { RemindersSection } from "@/components/settings/RemindersSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Account self-service: every signed-in user can change their own username + password. */
export function AccountSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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
    },
  });

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message),
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
                  <p className="text-sm font-medium">Authentik</p>
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
                Connect single sign-on so you can also sign in with Authentik.
              </p>
              <Button size="sm" variant="outline" asChild>
                <a href="/api/auth/oidc/link">
                  <Link2 className="h-3.5 w-3.5" /> Connect Authentik
                </a>
              </Button>
            </div>
          )}
        </section>
      )}

      <RemindersSection />

      {/* Danger zone: irreversible self-service actions, each gated by re-typing
          the account's own username. Collapsed by default so it's tucked away. */}
      <details className="rounded-md border border-destructive/40 bg-destructive/5">
        <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-xs font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> Danger zone
        </summary>
        <div className="space-y-3 border-t border-destructive/20 p-3">
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
          <p className="border-t border-destructive/20 pt-3 text-xs text-muted-foreground">
            This is the primary admin account and can't be deleted.
          </p>
        ) : (
          <div className="space-y-2 border-t border-destructive/20 pt-3">
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
