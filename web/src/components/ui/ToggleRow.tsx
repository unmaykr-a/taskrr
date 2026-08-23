import { cn } from "@/lib/utils";

/**
 * ToggleRow — a labelled on/off row.
 *
 * The shape almost every switch in the app takes: a description on the left,
 * an optional sub-line under it, a checkbox on the right. Lives in ui/ rather
 * than settings/ because task options use it too.
 */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-center justify-between gap-2 text-sm", disabled && "opacity-50")}>
      <span className="text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
