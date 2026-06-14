import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Globe, Moon, RotateCcw, Share2, Sparkles, Sun, Upload, X } from "lucide-react";

import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { useAuth } from "@/components/AuthProvider";

import {
  type BackgroundEffect,
  DEFAULT_THEME,
  type FontChoice,
  generateTheme,
  type Harmony,
  PRESETS,
  type Theme,
  type ThemeColors,
  toggledMode,
} from "@/lib/theme";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/ColorPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/Toast";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "card", label: "Panel" },
  { key: "sidebar", label: "Sidebar" },
  { key: "border", label: "Border" },
  { key: "foreground", label: "Text" },
  { key: "accent", label: "Accent" },
];

const EFFECTS: { value: BackgroundEffect; label: string }[] = [
  { value: "none", label: "None" },
  { value: "stars", label: "Starfield" },
  { value: "synapse", label: "Synapse" },
  { value: "perlin", label: "Flow field" },
  { value: "aurora", label: "Aurora" },
  { value: "waves", label: "Waves" },
  { value: "rain", label: "Rain" },
  { value: "petals", label: "Petals" },
  { value: "sparkles", label: "Sparkles" },
  { value: "embers", label: "Embers" },
  { value: "fireflies", label: "Fireflies" },
  { value: "comets", label: "Comets" },
];

/** The visual theme customizer (the "Theme" settings section). */
export function ThemeCustomizer() {
  const { theme, setTheme } = useTheme();
  const { prefs, setPrefs } = usePrefs();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [harmony, setHarmony] = useState<Harmony>("complementary");
  const fileRef = useRef<HTMLInputElement>(null);
  const setDefault = useMutation({ mutationFn: () => api.setDefaultTheme(theme) });

  // Saved themes now live in the account's prefs (server-side), so they follow
  // the account and survive logout — they used to be in localStorage and got
  // wiped on sign-out.
  const saved = prefs.savedThemes ?? [];

  // What the instance allows (sharing) and shared themes everyone can apply.
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
    enabled: isAdmin,
  });
  const { data: shared } = useQuery({ queryKey: ["shared-themes"], queryFn: api.listSharedThemes });

  const saveSetting = useMutation({
    mutationFn: api.putSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      queryClient.invalidateQueries({ queryKey: ["auth-config"] });
    },
  });
  const share = useMutation({
    mutationFn: (t: Theme) => api.shareTheme(t),
    onSuccess: (list) => queryClient.setQueryData(["shared-themes"], list),
  });
  const unshare = useMutation({
    mutationFn: (n: string) => api.unshareTheme(n),
    onSuccess: (list) => queryClient.setQueryData(["shared-themes"], list),
  });

  // Any user-initiated theme change applies it AND marks the account as having
  // customised its theme, so the enforced site default no longer overrides it.
  const applyTheme = (t: Theme) => {
    setTheme(t);
    if (!prefs.themeCustom) setPrefs({ themeCustom: true });
  };

  const patch = (p: Partial<Theme>) => applyTheme({ ...theme, ...p });
  const setColor = (key: keyof ThemeColors, value: string) =>
    applyTheme({ ...theme, colors: { ...theme.colors, [key]: value } });

  const applyPreset = (p: Theme) => applyTheme({ ...p });
  const generate = () => patch({ colors: generateTheme(theme.colors.accent, theme.mode, harmony) });

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPrefs({ savedThemes: [...saved.filter((t) => t.name !== trimmed), { ...theme, name: trimmed }] });
    setName("");
  }
  const remove = (n: string) => setPrefs({ savedThemes: saved.filter((t) => t.name !== n) });

  function exportTheme() {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taskrr-theme-${theme.name || "custom"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importTheme(file: File) {
    file
      .text()
      .then((text) => applyTheme({ ...DEFAULT_THEME, ...(JSON.parse(text) as Theme) }))
      .catch(() => alert("That file isn't a valid Taskrr theme."));
  }

  return (
    <div className="space-y-5">
      {/* Light / dark — remembers the theme you had in each mode and swaps. */}
      <section className="space-y-2">
        <Label>Mode</Label>
        <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => theme.mode !== m && applyTheme(toggledMode(theme))}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 capitalize transition-colors",
                theme.mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {m}
            </button>
          ))}
        </div>
      </section>

      {/* Presets */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Presets</h3>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors hover:bg-accent",
                theme.name === p.name && "ring-1 ring-primary",
              )}
            >
              <span className="flex -space-x-1">
                {[p.colors.background, p.colors.card, p.colors.accent].map((c, i) => (
                  <span
                    key={i}
                    className="h-4 w-4 rounded-full border border-black/20"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Shared themes — admin-published, available to everyone. */}
      {shared && shared.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Shared themes</h3>
          <div className="grid grid-cols-3 gap-2">
            {shared.map((p) => (
              <div
                key={p.name}
                className={cn(
                  "group relative flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors hover:bg-accent",
                  theme.name === p.name && "ring-1 ring-primary",
                )}
              >
                <button className="flex min-w-0 items-center gap-2" onClick={() => applyPreset(p)}>
                  <span className="flex -space-x-1">
                    {[p.colors.background, p.colors.card, p.colors.accent].map((c, i) => (
                      <span
                        key={i}
                        className="h-4 w-4 rounded-full border border-black/20"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </span>
                  <span className="truncate">{p.name}</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    aria-label={`Unshare ${p.name}`}
                    title="Stop sharing"
                    onClick={() => unshare.mutate(p.name)}
                    className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Colors */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Colors</h3>
        <div className="grid grid-cols-2 gap-2">
          {COLOR_FIELDS.map((f) => (
            <ColorField
              key={f.key}
              label={f.label}
              value={theme.colors[f.key]}
              onChange={(hex) => setColor(f.key, hex)}
            />
          ))}
        </div>
      </section>

      {/* Font + frosted */}
      <section className="space-y-2">
        <div className="space-y-1">
          <Label>Font</Label>
          <select
            className={SELECT}
            value={theme.font}
            onChange={(e) => patch({ font: e.target.value as FontChoice })}
          >
            <option value="mono" className="bg-background">Monospace</option>
            <option value="sans" className="bg-background">Sans-serif</option>
          </select>
        </div>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Frosted glass
            <span className="block text-xs">Translucent windows, sidebar, and task cards with a backdrop blur</span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={theme.frosted}
            onChange={(e) => patch({ frosted: e.target.checked })}
          />
        </label>
      </section>

      {/* Harmony generator + preview */}
      <section className="space-y-2 rounded-lg border p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4" /> Color Harmony
        </h3>
        <p className="text-xs text-muted-foreground">
          Pick a base accent, then Generate a coordinated palette around it.
        </p>
        <ColorField
          label="Base accent"
          value={theme.colors.accent}
          onChange={(hex) => setColor("accent", hex)}
        />
        <div className="flex items-center gap-2">
          <select
            className={SELECT}
            value={harmony}
            onChange={(e) => setHarmony(e.target.value as Harmony)}
          >
            <option value="complementary" className="bg-background">Complementary</option>
            <option value="analogous" className="bg-background">Analogous</option>
            <option value="triadic" className="bg-background">Triadic</option>
            <option value="monochrome" className="bg-background">Monochrome</option>
          </select>
          <Button type="button" size="sm" onClick={generate}>
            Generate
          </Button>
        </div>
        <div className="grid grid-cols-6 gap-1 pt-1">
          {COLOR_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col items-center gap-1" title={f.label}>
              <span
                className="h-6 w-full rounded border border-black/20"
                style={{ backgroundColor: theme.colors[f.key] }}
              />
              <span className="text-[9px] leading-none text-muted-foreground">{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Background effect */}
      <details className="rounded-lg border">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">Background</summary>
        <div className="space-y-2 border-t p-3">
        <select
          className={SELECT}
          value={theme.background}
          onChange={(e) => patch({ background: e.target.value as BackgroundEffect })}
        >
          {EFFECTS.map((e) => (
            <option key={e.value} value={e.value} className="bg-background">
              {e.label}
            </option>
          ))}
        </select>
        {theme.background !== "none" && (
          <>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Intensity</Label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={theme.intensity}
                  onChange={(e) => patch({ intensity: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Size</Label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={theme.size}
                  onChange={(e) => patch({ size: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Visibility: {Math.round((theme.bgOpacity ?? 1) * 100)}%
              </Label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={theme.bgOpacity ?? 1}
                onChange={(e) => patch({ bgOpacity: Number(e.target.value) })}
                className="w-full accent-primary"
                aria-label="Background effect visibility"
              />
            </div>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Custom colour
                <span className="block text-xs">Off = the effect follows the accent</span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
                checked={!!theme.bgColor}
                onChange={(e) =>
                  patch({ bgColor: e.target.checked ? theme.colors.accent : "" })
                }
              />
            </label>
            {!!theme.bgColor && (
              <ColorField
                label="Effect colour"
                value={theme.bgColor}
                onChange={(hex) => patch({ bgColor: hex })}
              />
            )}
          </>
        )}
        {/* Animation controls live here, next to the background they drive. */}
        <label className="flex items-center justify-between gap-2 pt-1 text-sm">
          <span className="text-muted-foreground">Animations</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={prefs.animations}
            onChange={(e) => setPrefs({ animations: e.target.checked })}
          />
        </label>
        {prefs.animations && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Animation speed: {prefs.animationSpeed}×</Label>
            <input
              type="range"
              min={0.25}
              max={2}
              step={0.25}
              value={prefs.animationSpeed}
              onChange={(e) => setPrefs({ animationSpeed: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
        )}
        </div>
      </details>

      {/* Save / share */}
      <details className="rounded-lg border">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">Save &amp; share</summary>
        <div className="space-y-2 border-t p-3">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Theme name…"
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <Button type="button" size="sm" onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </div>
        {saved.length > 0 && (
          <div className="space-y-1">
            {saved.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                <button className="flex min-w-0 items-center gap-2 hover:underline" onClick={() => applyPreset(t)}>
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-black/20"
                    style={{ backgroundColor: t.colors.accent }}
                  />
                  <span className="truncate">{t.name}</span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Publish a saved theme to all users when sharing is enabled —
                      admins always, regular users when the admin allows it. */}
                  {config?.themesShareable && (isAdmin || config?.themesShareUsers) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        const anchor = e.currentTarget;
                        share.mutate(t, {
                          onSuccess: () => toast("Shared with everyone", { anchor, tone: "success" }),
                        });
                      }}
                      disabled={share.isPending}
                      title="Share with everyone"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary disabled:opacity-50"
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </button>
                  )}
                  <button
                    onClick={() => remove(t.name)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {share.isError && <p className="text-xs text-destructive">{(share.error as Error).message}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => fileRef.current?.click()}>
            <Upload /> Import
          </Button>
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={exportTheme}>
            <Download /> Export
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importTheme(e.target.files[0])}
          />
        </div>
        {isAdmin && (
          <div className="space-y-2 rounded-lg border p-3">
            <h4 className="text-xs font-semibold text-muted-foreground">Site themes (admin)</h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={setDefault.isPending}
              onClick={() => setDefault.mutate()}
            >
              <Globe />
              {setDefault.isSuccess
                ? "Saved as site default"
                : setDefault.isPending
                  ? "Saving…"
                  : "Set this as the site default"}
            </Button>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Use the default for everyone
                <span className="block text-xs">
                  Accounts that haven't picked their own theme follow the site default.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
                checked={settings?.default_theme_enforce ?? false}
                onChange={(e) => saveSetting.mutate({ default_theme_enforce: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Allow sharing themes
                <span className="block text-xs">
                  Adds a Share button on saved themes to publish them to all users.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
                checked={settings?.themes_shareable ?? false}
                onChange={(e) => saveSetting.mutate({ themes_shareable: e.target.checked })}
              />
            </label>
            {settings?.themes_shareable && (
              <label className="flex items-center justify-between gap-2 pl-3 text-sm">
                <span className="text-muted-foreground">
                  Let everyone share
                  <span className="block text-xs">
                    Regular users get the Share button too, not just admins.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary"
                  checked={settings?.themes_share_users ?? false}
                  onChange={(e) => saveSetting.mutate({ themes_share_users: e.target.checked })}
                />
              </label>
            )}
          </div>
        )}
        </div>
      </details>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => applyTheme({ ...DEFAULT_THEME })}
      >
        <RotateCcw /> Reset to default
      </Button>
    </div>
  );
}
