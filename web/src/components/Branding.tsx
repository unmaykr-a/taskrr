import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { api, type Branding as BrandingData } from "@/lib/api";
import { setBrandIcon } from "@/lib/theme";

const DEFAULTS: BrandingData = {
  name: "Taskrr",
  title: "",
  tagline: "last-done tracker",
  icon: "",
  loginHideIcon: false,
  loginHideText: false,
};

/** Read the instance branding from auth config (with defaults). Available
 *  signed-in and signed-out, since the login page is branded too. */
export function useBranding(): BrandingData {
  const { data } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  return data?.branding ?? DEFAULTS;
}

/**
 * Applies the instance branding that lives outside React's tree: the document
 * (tab) title and the favicon. Mounted once near the root; renders nothing.
 */
export function BrandingApplier() {
  const branding = useBranding();

  useEffect(() => {
    document.title = branding.title.trim() || branding.name.trim() || "Taskrr";
  }, [branding.title, branding.name]);

  // A custom icon overrides the generated checkmark favicon; clearing it falls
  // back to the theme-coloured mark.
  useEffect(() => {
    setBrandIcon(branding.icon || null);
  }, [branding.icon]);

  return null;
}
