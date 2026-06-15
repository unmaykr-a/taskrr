import { type KeyboardEvent, useState } from "react";
import { X } from "lucide-react";

/**
 * TagInput is a small chip editor: existing tags show as removable chips, and a
 * text field adds new ones (Enter or comma commits; Backspace on an empty field
 * removes the last). Duplicates (case-insensitive) are ignored.
 */
export function TagInput({
  value,
  onChange,
  placeholder = "Add a tag",
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const t = raw.trim();
    setDraft("");
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
  };
  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus-within:ring-2 focus-within:ring-ring">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => remove(tag)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-[6rem] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
