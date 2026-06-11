import { createContext, type ReactNode, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type User } from "@/lib/api";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  /** Re-fetch the current user (after login/logout/register). */
  refresh: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

/**
 * AuthProvider resolves the current user from /api/auth/me. A 401 returns null
 * (not an error), so the app can show the login screen. Everything below it
 * reads the user via useAuth().
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 60_000,
  });

  const value: AuthCtx = {
    user: data ?? null,
    loading: isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within an AuthProvider");
  return c;
}
