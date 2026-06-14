import { Loader2 } from "lucide-react";

import App from "@/App";
import { useAuth } from "@/components/AuthProvider";
import { AuthPage } from "@/components/AuthPage";
import { Background } from "@/components/Background";
import { BrandingApplier } from "@/components/Branding";
import { DemoBanner } from "@/components/DemoBanner";

/**
 * Gate decides what to render based on auth state: a brief splash while we check
 * the session, the login/register card when signed out, or the app when signed
 * in. The animated background sits behind all three.
 */
export function Gate() {
  const { user, loading } = useAuth();

  return (
    <>
      <BrandingApplier />
      <Background />
      {loading ? (
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : user ? (
        <App />
      ) : (
        <AuthPage />
      )}
      <DemoBanner />
    </>
  );
}
