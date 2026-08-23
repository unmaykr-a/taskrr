import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Select — a native `<select>` in the app's input styling.
 *
 * There is no custom dropdown here on purpose: the native control is the one
 * that behaves correctly on a phone, with a keyboard, and with a screen reader,
 * and nothing about picking one of five options is worth reimplementing.
 *
 * The one wrinkle it fixes everywhere at once: the field is transparent so it
 * takes the theme, but a transparent `<option>` is unreadable in several
 * browsers' native menus — hence `bg-background` on the options, which every
 * copy of this markup used to have to remember for itself.
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-background",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export { Select };
