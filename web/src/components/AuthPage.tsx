import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, LogIn } from "lucide-react";

import {
  api,
  isClaimChallenge,
  isPendingRegistration,
  type LoginResult,
  type PendingRegistration,
  type User,
} from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import { DEFAULT_THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";

type Tab = "login" | "register";

/**
 * AuthPage is the centred sign-in card shown when no one is logged in. It has
 * Login / Register tabs (Register hidden when local registration is disabled),
 * a "Sign in with Authentik" button when OIDC is on, and a "set your first
 * password" step for admin-created accounts that haven't been claimed yet.
 */
export function AuthPage() {
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const [tab, setTab] = useState<Tab>("login");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [claiming, setClaiming] = useState(false); // "set your first password" mode
  const [pending, setPending] = useState(false); // registration awaiting approval

  const canRegister = config?.localRegistration ?? false;
  const active = tab === "register" && canRegister ? "register" : "login";

  // Apply the admin's site-wide default theme on the signed-out screen.
  const defaultTheme = config?.defaultTheme;
  useEffect(() => {
    if (defaultTheme) setTheme({ ...DEFAULT_THEME, ...defaultTheme });
  }, [defaultTheme, setTheme]);

  // A fresh sign-in must not inherit a previous user's cached tasks/calendar. We
  // update the ["me"] query *in place* (so its observer re-renders and the app
  // shows immediately) and drop only the other queries — destroying ["me"] with
  // clear() orphaned its observer, which is why it used to need a reload.
  const finishAuth = (user: User) => {
    queryClient.setQueryData(["me"], user);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  };

  const submit = useMutation({
    mutationFn: async (): Promise<LoginResult | PendingRegistration> => {
      const name = username.trim();
      if (claiming) return api.claim(name, password);
      if (active === "register") return api.register(name, password);
      return api.login(name, password);
    },
    onSuccess: (res) => {
      // Registration may be queued for admin approval.
      if (isPendingRegistration(res)) {
        setPending(true);
        return;
      }
      // The login endpoint may ask us to set a first password instead.
      if (isClaimChallenge(res)) {
        setClaiming(true);
        setPassword("");
        return;
      }
      finishAuth(res);
    },
  });

  const cancelClaim = () => {
    setClaiming(false);
    setPassword("");
    submit.reset();
  };

  const buttonLabel = submit.isPending
    ? "Please wait…"
    : claiming
      ? "Set password & sign in"
      : active === "register"
        ? "Create account"
        : "Sign in";

  return (
    <div className="relative z-10 h-[100dvh] overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border bg-card/95 p-6 shadow-2xl backdrop-blur">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Taskrr</h1>
            <p className="text-xs text-muted-foreground">last-done tracker</p>
          </div>
        </div>

        {pending ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center text-sm">
            <p className="font-medium text-foreground">Request received</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your account is awaiting admin approval. You'll be able to sign in once it's approved.
            </p>
            <button
              type="button"
              onClick={() => {
                setPending(false);
                setTab("login");
                setPassword("");
                submit.reset();
              }}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
          <>
        {claiming ? (
          <div className="mb-4 rounded-lg border border-primary/40 bg-primary/10 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Set your password</p>
            <p className="mt-0.5">
              The account <span className="font-medium text-foreground">{username.trim()}</span> doesn't
              have a password yet. Choose one (min 8 characters) to finish setting it up.
            </p>
          </div>
        ) : (
          canRegister && (
            <div
              ref={tabsRef}
              className="relative mb-4 grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1 text-sm"
            >
              {/* The filled pill slides between the tabs. */}
              <SlidingHighlight containerRef={tabsRef} activeKey={active} className="rounded-md bg-primary" />
              {(["login", "register"] as Tab[]).map((t) => (
                <button
                  key={t}
                  data-slide-key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "relative rounded-md py-1.5 capitalize transition-colors duration-200",
                    active === t ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          )
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password) submit.mutate();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="auth-username">Username</Label>
            <Input
              id="auth-username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              readOnly={claiming}
              className={cn(claiming && "opacity-70")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password">{claiming ? "New password" : "Password"}</Label>
            <Input
              id="auth-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={active === "register" || claiming ? "new-password" : "current-password"}
            />
          </div>

          {submit.isError && (
            <p className="text-sm text-destructive">{(submit.error as Error).message}</p>
          )}

          <Button type="submit" className="w-full" disabled={submit.isPending || !username.trim() || !password}>
            {claiming ? <KeyRound /> : <LogIn />} {buttonLabel}
          </Button>

          {claiming && (
            <button
              type="button"
              onClick={cancelClaim}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back to sign in
            </button>
          )}
        </form>

        {/* OIDC / Authentik sign-in sits below the login button (when enabled). */}
        {!claiming && config?.oidc && (
          <a
            href="/api/auth/oidc/login"
            className="mt-2 flex w-full items-center justify-center rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            Sign in with Authentik
          </a>
        )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
