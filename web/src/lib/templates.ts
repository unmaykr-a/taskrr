// templates.ts — reusable task setups.
//
// Duplicate already copies a task's setup without its history, which covers
// "another one like that one". A template covers the case duplicate can't: the
// shape exists in your head, not in the list — a new houseplant, a new bike
// service — and there is nothing to duplicate from yet.
//
// Stored in the account's preferences alongside saved themes, so they follow the
// account without a table, a migration or an endpoint of their own.
//
// Pure and React-free, so the rules are testable (templates.test.ts).

import type { Task, TaskInput } from "./api";

/** A saved task setup. Deliberately no colours: a template is about what the
 *  task *is*, and colours are a per-task decoration people rarely want cloned. */
export interface TaskTemplate {
  name: string;
  description: string;
  intervalSeconds: number | null;
  tags: string[];
  folder: string;
}

export const MAX_TEMPLATES = 30;

/** Build a template from an existing task. */
export function templateFromTask(task: Task, name: string): TaskTemplate {
  return {
    name: name.trim(),
    description: task.description,
    intervalSeconds: task.intervalSeconds,
    tags: [...task.tags],
    folder: task.folder,
  };
}

/** What a new task starts as when built from a template. */
export function templateToInput(t: TaskTemplate): TaskInput {
  return {
    name: t.name,
    description: t.description,
    intervalSeconds: t.intervalSeconds,
    tags: [...t.tags],
    folder: t.folder,
  };
}

/**
 * Add or replace a template, newest last.
 *
 * Names are the identity, matched case-insensitively, so saving over one you
 * already have updates it rather than quietly collecting near-duplicates.
 */
export function saveTemplate(list: TaskTemplate[] | undefined, t: TaskTemplate): TaskTemplate[] {
  const name = t.name.trim();
  if (!name) return list ?? [];
  const rest = (list ?? []).filter((x) => x.name.toLowerCase() !== name.toLowerCase());
  // Oldest goes when the cap is hit — a template nobody has re-saved.
  return [...rest, { ...t, name }].slice(-MAX_TEMPLATES);
}

export function deleteTemplate(list: TaskTemplate[] | undefined, name: string): TaskTemplate[] {
  return (list ?? []).filter((x) => x.name.toLowerCase() !== name.trim().toLowerCase());
}

export function findTemplate(list: TaskTemplate[] | undefined, name: string): TaskTemplate | null {
  return (list ?? []).find((x) => x.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}
