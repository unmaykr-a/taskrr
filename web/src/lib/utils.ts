import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** cn merges class names and resolves Tailwind conflicts deterministically. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
