import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";

import { api, type BackgroundImage } from "@/lib/api";
import { type BackgroundFit, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { useBranding } from "@/components/Branding";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

/**
 * Your own background pictures: upload a few, pick which one is up, and how it
 * sits behind the app.
 *
 * The whole group is hidden when the admin has switched per-user backgrounds
 * off — an upload button that always fails is worse than no upload button.
 */
export function BackgroundImageSection() {
  const { prefs, setPrefs } = usePrefs();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const branding = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const enabled = config?.userBackgrounds ?? false;
  const limits = config?.backgroundLimits;
  // The accepted types and the size in the hint both come from the instance, so
  // the file picker and the message can't drift from what the server will take.
  const accept = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/avif",
    "image/gif",
    ...(limits?.allowSVG ? ["image/svg+xml"] : []),
  ].join(",");
  const { data: images } = useQuery({
    queryKey: ["backgrounds"],
    queryFn: api.listBackgrounds,
    enabled,
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadBackground(file),
    onSuccess: (bg) => {
      queryClient.invalidateQueries({ queryKey: ["backgrounds"] });
      // Pick what you just uploaded: nobody uploads a wallpaper in order to go
      // on looking at the old one.
      setPrefs({ bgImage: String(bg.id) });
      toast("Background added", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteBackground(id),
    onSuccess: (_r, id) => {
      queryClient.invalidateQueries({ queryKey: ["backgrounds"] });
      if (prefs.bgImage === String(id)) setPrefs({ bgImage: "" });
      toast("Background removed", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  if (!enabled) return null;

  const list = images ?? [];
  const showing = prefs.bgImage !== "none" && (prefs.bgImage !== "" || branding.background > 0);

  return (
    <SettingsGroup
      id="theme.bgimage"
      title="Background image"
      icon={<ImageIcon />}
      summary={showing ? "On" : "Off"}
    >
      <p className="text-xs text-muted-foreground">
        A picture behind the app, under whichever effect is running. Yours alone —
        nobody else sees it.
      </p>

      <Select
        value={prefs.bgImage}
        onChange={(e) => setPrefs({ bgImage: e.target.value })}
        aria-label="Background image"
      >
        {/* "" means "whatever the instance uses", which reads differently
            depending on whether the admin actually set one. */}
        <option value="">
          {branding.background > 0 ? "Instance background" : "None (no instance background set)"}
        </option>
        <option value="none">None</option>
        {list.map((b: BackgroundImage) => (
          <option key={b.id} value={String(b.id)}>
            {b.name}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" /> {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          PNG, JPEG, WebP, AVIF{limits?.allowSVG ? ", GIF or SVG" : " or GIF"}, up to{" "}
          {limits?.imageMB ?? 8} MB
        </span>
      </div>

      {list.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {list.map((b: BackgroundImage) => {
            const active = prefs.bgImage === String(b.id);
            return (
              <div
                key={b.id}
                className={cn(
                  "group relative overflow-hidden rounded-md border",
                  active && "ring-2 ring-primary",
                )}
              >
                <button
                  type="button"
                  onClick={() => setPrefs({ bgImage: String(b.id) })}
                  title={b.name}
                  className="block h-16 w-full"
                >
                  <img
                    src={`/api/backgrounds/${b.id}`}
                    alt={b.name}
                    className="h-full w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${b.name}`}
                  disabled={remove.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Delete background",
                      description: `"${b.name}" is removed for good. Anywhere it's in use falls back to the instance background.`,
                      confirmText: "Delete",
                      destructive: true,
                    });
                    if (ok) remove.mutate(b.id);
                  }}
                  className="absolute right-1 top-1 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showing && (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Fit</Label>
            <Select
              value={prefs.bgImageFit}
              onChange={(e) => setPrefs({ bgImageFit: e.target.value as BackgroundFit })}
            >
              <option value="cover">Fill the screen</option>
              <option value="contain">Fit inside</option>
              <option value="tile">Tile</option>
            </Select>
          </div>
          <div className="space-y-1">
            {/* The dial that makes a photograph a surface you can read text on. */}
            <Label className="text-xs text-muted-foreground">
              Dim: {Math.round(prefs.bgImageDim * 100)}%
            </Label>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={prefs.bgImageDim}
              onChange={(e) => setPrefs({ bgImageDim: Number(e.target.value) })}
              className="w-full accent-primary"
              aria-label="Background image dim"
            />
          </div>
        </>
      )}
    </SettingsGroup>
  );
}
