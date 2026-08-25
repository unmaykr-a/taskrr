import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { useAuth } from "@/components/AuthProvider";
import { useBranding } from "@/components/Branding";

/**
 * The static picture behind the app, under the animated canvas.
 *
 * Two sources, in this order: the one you picked, then the one the admin set
 * for the instance. "none" is a real choice rather than the absence of one — on
 * an instance with a background you may simply not want it, and clearing your
 * own pick would otherwise put the instance's back.
 *
 * Signed out there is no "you", so the login page always shows the instance
 * picture (its bytes are served without a session for exactly that reason).
 */
export function useBackgroundImageUrl(): string | null {
  const { prefs } = usePrefs();
  const { user } = useAuth();
  const branding = useBranding();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });

  const instance = branding.background > 0 ? `/api/backgrounds/${branding.background}` : null;
  if (!user) return instance;
  // The admin can withdraw per-user backgrounds after people have set one, so
  // the switch is checked here as well as in the settings UI — otherwise
  // turning it off would leave everyone's own picture up with no way to change
  // it.
  if (config && !config.userBackgrounds) return instance;
  if (prefs.bgImage === "none") return null;
  if (prefs.bgImage) return `/api/backgrounds/${prefs.bgImage}`;
  return instance;
}

export function BackgroundImage() {
  const { prefs } = usePrefs();
  const url = useBackgroundImageUrl();
  if (!url) return null;

  const tile = prefs.bgImageFit === "tile";
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${url}")`,
          backgroundSize: tile ? "auto" : prefs.bgImageFit,
          backgroundRepeat: tile ? "repeat" : "no-repeat",
          backgroundPosition: "center",
          // A fixed attachment would repaint the image on every scroll; the
          // layer is already position: fixed, so it stays put for free.
        }}
      />
      {/* The page colour laid back over the picture. Text sits on top of both,
          and a photograph is rarely a readable surface on its own — this is the
          dial that makes one usable without editing the image. */}
      <div
        className="absolute inset-0 bg-background"
        style={{ opacity: prefs.bgImageDim }}
      />
    </div>
  );
}
