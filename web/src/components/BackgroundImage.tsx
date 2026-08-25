import { useEffect } from "react";
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
  const owned = config?.userBackgrounds ?? false;
  // The same listing the settings section uses, so this costs nothing extra
  // there — and here it is the only way to know a picked image still exists.
  const { data: images } = useQuery({
    queryKey: ["backgrounds"],
    queryFn: api.listBackgrounds,
    enabled: !!user && owned,
  });

  const instance = branding.background > 0 ? `/api/backgrounds/${branding.background}` : null;
  if (!user) return instance;
  // The admin can withdraw per-user backgrounds after people have set one, so
  // the switch is checked here as well as in the settings UI — otherwise
  // turning it off would leave everyone's own picture up with no way to change
  // it.
  if (!owned) return instance;
  if (prefs.bgImage === "none") return null;
  if (prefs.bgImage) {
    // A pick can outlive the picture: deleted from another device, or gone
    // with a restored backup that predates it. Falling back to the instance
    // beats a fixed request for bytes that aren't there any more.
    if (images && !images.some((i) => String(i.id) === prefs.bgImage)) return instance;
    return `/api/backgrounds/${prefs.bgImage}`;
  }
  return instance;
}

export function BackgroundImage() {
  const { prefs, setPrefs } = usePrefs();
  const { user } = useAuth();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const { data: images } = useQuery({
    queryKey: ["backgrounds"],
    queryFn: api.listBackgrounds,
    enabled: !!user && (config?.userBackgrounds ?? false),
  });
  const url = useBackgroundImageUrl();

  // Heal a pick that points at nothing, wherever you happen to be in the app —
  // the picture may have been deleted from another device, or gone with a
  // restored backup that predates it. The hook above already falls back for the
  // render; this is what stops the settings page saying "On" for a picture that
  // no longer exists, and stops the dead id being synced back to the account.
  useEffect(() => {
    if (!images || !prefs.bgImage || prefs.bgImage === "none") return;
    if (!images.some((b) => String(b.id) === prefs.bgImage)) setPrefs({ bgImage: "" });
  }, [images, prefs.bgImage, setPrefs]);

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
