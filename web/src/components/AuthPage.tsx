import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, LogIn } from "lucide-react";

import {
  api,
  isClaimChallenge,
  isPendingRegistration,
  type LoginResult,
  type PendingRegistration,
  type User,
} from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import { useBranding } from "@/components/Branding";
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
 * an SSO button when OIDC is on, and a "set your first
 * password" step for admin-created accounts that haven't been claimed yet.
 */
export function AuthPage() {
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const branding = useBranding();
  const [tab, setTab] = useState<Tab>("login");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [claiming, setClaiming] = useState(false); // "set your first password" mode
  const [pending, setPending] = useState(false); // registration awaiting approval
  // The invitation from the link, if this page was opened by following one, and
  // the account that signing in said is still waiting for its link.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [needsInvite, setNeedsInvite] = useState<string | null>(null);

  const canRegister = config?.localRegistration ?? false;
  const active = tab === "register" && canRegister ? "register" : "login";
  // OIDC-only: the local username/password form is hidden entirely; the server
  // also refuses local sign-in (except the primary admin's break-glass path).
  const oidcOnly = !!config?.oidcOnly;

  // An invitation arrives in the URL's fragment, which the browser keeps to
  // itself — so the secret never reaches a proxy's access log or a Referer
  // header on the way here. Take it out of the address bar straight away, so a
  // bookmark or a shared screenshot of this page doesn't carry it either.
  useEffect(() => {
    const found = /(?:^|&)invite=([^&]*)/.exec(window.location.hash.replace(/^#/, ""));
    if (!found) return;
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    setInviteToken(decodeURIComponent(found[1]));
  }, []);

  // Ask whose account the link opens, so the person following it doesn't have
  // to have been told a username as well.
  const invite = useQuery({
    queryKey: ["invite", inviteToken],
    queryFn: () => api.inviteInfo(inviteToken as string),
    enabled: !!inviteToken,
    retry: false,
  });
  const invitedUsername = invite.data?.username;
  useEffect(() => {
    if (!invitedUsername) return;
    setUsername(invitedUsername);
    setNeedsInvite(null);
    setClaiming(true);
  }, [invitedUsername]);

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
      if (claiming) return api.claim(name, password, inviteToken ?? "");
      if (active === "register") return api.register(name, password);
      return api.login(name, password);
    },
    onSuccess: (res) => {
      // Registration may be queued for admin approval.
      if (isPendingRegistration(res)) {
        setPending(true);
        return;
      }
      // The account exists but has never been set up, and setting it up takes
      // the invitation the admin was given — a password alone won't do it.
      if (isClaimChallenge(res)) {
        setNeedsInvite(res.username);
        setPassword("");
        return;
      }
      finishAuth(res);
    },
  });

  const cancelClaim = () => {
    setClaiming(false);
    setNeedsInvite(null);
    setInviteToken(null);
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

  // Three layouts, all the same form.
  //
  // "centered" is the card the app has always had. "left" and "right" put the
  // form in a full-height panel down one side and let the animated background
  // have the rest — the split that identity providers tend to use, and the one
  // that actually shows off a background effect instead of hiding it behind a
  // small card. On a phone every layout collapses to the same full-width panel,
  // because there is no room for a split and nothing to show beside it.
  const split = branding.loginLayout === "left" || branding.loginLayout === "right";

  return (
    <div
      className={cn(
        "relative z-10 h-[100dvh] overflow-y-auto",
        split && "sm:flex sm:overflow-hidden",
        branding.loginLayout === "right" && "sm:flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "flex min-h-full items-center justify-center p-4",
          split &&
            "sm:min-h-0 sm:h-full sm:w-[26rem] sm:shrink-0 sm:overflow-y-auto sm:border-r sm:bg-card/95 sm:p-8 sm:backdrop-blur",
          branding.loginLayout === "right" && "sm:border-l sm:border-r-0",
        )}
      >
        <div
          className={cn(
            "w-full max-w-sm",
            // The panel already provides the surface in a split layout, so the
            // card loses its own border and shadow rather than nesting two.
            split
              ? "rounded-2xl border bg-card/95 p-6 shadow-2xl backdrop-blur sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none"
              : "rounded-2xl border bg-card/95 p-6 shadow-2xl backdrop-blur",
          )}
        >
        {(!branding.loginHideIcon || !branding.loginHideText) && (
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            {!branding.loginHideIcon &&
              (branding.icon ? (
                <img src={branding.icon} alt="" className="h-11 w-11 rounded-xl object-cover shadow" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
                  <Check className="h-6 w-6" strokeWidth={3} />
                </div>
              ))}
            {!branding.loginHideText && (
              <div>
                <h1 className="text-lg font-semibold tracking-tight">{branding.name}</h1>
                {branding.tagline && <p className="text-xs text-muted-foreground">{branding.tagline}</p>}
              </div>
            )}
          </div>
        )}

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
        {!oidcOnly && (
        <>
        {claiming ? (
          <div className="mb-4 rounded-lg border border-primary/40 bg-primary/10 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Set your password</p>
            <p className="mt-0.5">
              The account <span className="font-medium text-foreground">{username.trim()}</span> is
              waiting for you. Choose a password (min 8 characters) to finish setting it up.
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

        {/* Followed a link that has been used, has lapsed, or was mistyped. */}
        {invite.isError && !claiming && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">That invitation isn't valid any more</p>
            <p className="mt-0.5">
              It may have been used already or run out. Ask an admin for a new link.
            </p>
          </div>
        )}

        {/* Signed in as an account nobody has set up yet. Setting a password
            takes the invitation, so point at it rather than offering a form
            that would only be refused. */}
        {needsInvite && (
          <div className="mb-4 rounded-lg border border-primary/40 bg-primary/10 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              {needsInvite} hasn't been set up yet
            </p>
            <p className="mt-0.5">
              Open the invitation link an admin sent you to choose a password. If you don't have
              one, or it has run out, ask them for a new link.
            </p>
          </div>
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
              autoFocus={!claiming}
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
              // Following an invitation, the username is already filled in and
              // read-only, so the only thing left to do is the one to land on.
              autoFocus={claiming}
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
        </>
        )}

        {oidcOnly && (
          <p className="mb-3 text-center text-sm text-muted-foreground">
            This instance uses single sign-on.
          </p>
        )}

        {/* SSO sign-in sits below the login button — or stands alone when the
            instance is OIDC-only (local accounts hidden). */}
        {!claiming && config?.oidc && (
          <a
            href="/api/auth/oidc/login"
            className={
              config.oidcOnly
                ? "flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                : "mt-2 flex w-full items-center justify-center rounded-md border px-3 py-2 text-sm hover:bg-accent"
            }
          >
            Sign in with SSO
          </a>
        )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
