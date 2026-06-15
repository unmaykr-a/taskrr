import { useId } from "react";

import { Input } from "@/components/ui/input";

/**
 * FolderInput is a plain text field for a task's folder, with a datalist of
 * existing folder names so it's easy to reuse one (or type a new one).
 */
export function FolderInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
}) {
  const listId = useId();
  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="No folder"
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
