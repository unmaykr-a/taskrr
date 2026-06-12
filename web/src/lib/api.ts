// Typed client for the Taskrr API. Mirrors the JSON shapes returned by the Go
// backend (camelCase fields). All timestamps are ISO 8601 strings.
//
// Everything network-related lives here so the rest of the app talks to a small,
// typed surface (`api.*`) instead of scattering fetch() calls through
// components. Swapping transport (e.g. to add auth headers later) happens in one
// place.

import type { Theme } from "./theme";
import { DEMO } from "./demo";
import { demoApi } from "./api.demo";

export interface Task {
  id: number;
  name: string;
  description: string;
  /** Desired cadence in seconds, or null for "just track, no schedule". */
  intervalSeconds: number | null;
  /** Per-task overrides for the staleness gradient ends ("#rrggbb"), or null. */
  colorFresh: string | null;
  colorOverdue: string | null;
  /** Pin the staleness colour to "fresh" (a visual "stay green" preference). */
  freezeColor: boolean;
  /** Non-null when the task is soft-archived (hidden from the normal views). */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastCompletedAt: string | null;
  completionCount: number;
}

export interface Completion {
  id: number;
  taskId: number;
  completedAt: string;
  note: string;
  createdAt: string;
}

/** A completion joined with its task name — the flat feed the calendar uses. */
export interface Activity {
  completionId: number;
  taskId: number;
  taskName: string;
  completedAt: string;
  note: string;
}

/** An authenticated account. Secrets are never sent to the client. */
export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  /** Whether a local password is set (false ⇒ unclaimed admin-created account). */
  passwordSet: boolean;
  /** Whether an OIDC identity is linked. */
  oidcLinked: boolean;
  /** The bootstrap admin — other admins can't edit/delete it. */
  protected: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Login can return either the user (success) or a prompt to claim the account
 *  by setting a first password (admin-created account with no password yet). */
export interface ClaimChallenge {
  claim: true;
  username: string;
}
export type LoginResult = User | ClaimChallenge;

/** Type guard: did login ask us to set a first password? */
export function isClaimChallenge(r: LoginResult): r is ClaimChallenge {
  return (r as ClaimChallenge).claim === true;
}

/** What the login page should offer (from the server's settings). */
export interface AuthConfig {
  localRegistration: boolean;
  oidc: boolean;
  /** SSO is the only way in (the primary admin keeps a password fallback). */
  oidcOnly: boolean;
  /** Local sign-ups need admin approval before they can sign in. */
  requiresApproval: boolean;
  /** Single-person instance: registration + adding accounts are disabled. */
  lite: boolean;
  /** Site-wide default theme to apply while signed out / for new users. */
  defaultTheme: Partial<Theme> | null;
}

/** Registration may complete (User) or be queued for approval. */
export interface PendingRegistration {
  pending: true;
  username: string;
}
export function isPendingRegistration(r: unknown): r is PendingRegistration {
  return typeof r === "object" && r !== null && (r as PendingRegistration).pending === true;
}

/** One row of the admin sessions view: a signed-in user and their activity. */
export interface SessionSummary {
  userId: number;
  username: string;
  role: "admin" | "user";
  /** How many live (non-expired) sessions this user has. */
  sessions: number;
  /** Most recent activity (ISO 8601). */
  lastSeen: string;
  /** The primary admin — other admins can't terminate its sessions. */
  protected: boolean;
}

/** Per-user reminder settings: deliver a webhook when a task is due. */
export interface ReminderSettings {
  enabled: boolean;
  webhookUrl: string;
  /** Fire this many seconds before the due time (0 = at due / once overdue). */
  leadSeconds: number;
}

/** One captured server/access log line (from the in-memory ring). */
export interface LogEntry {
  seq: number;
  time: string;
  text: string;
}

/** A backup file on disk. */
export interface BackupInfo {
  name: string;
  size: number;
  modTime: string;
}

/** Admin-editable instance settings (the client secret is never returned). */
export interface AdminSettings {
  reg_local: boolean;
  reg_oidc: boolean;
  reg_approval: boolean;
  oidc_issuer: string;
  oidc_client_id: string;
  oidc_redirect_url: string;
  oidc_admin_group: string;
  oidc_link_username: boolean;
  oidc_only: boolean;
  oidc_client_secret_set: boolean;
  oidc_enabled: boolean;
}

export type SettingsPatch = Partial<{
  reg_local: boolean;
  reg_oidc: boolean;
  reg_approval: boolean;
  oidc_issuer: string;
  oidc_client_id: string;
  oidc_client_secret: string;
  oidc_redirect_url: string;
  oidc_admin_group: string;
  oidc_link_username: boolean;
  oidc_only: boolean;
}>;

/** Fields a user can set when creating or editing a task. */
export interface TaskInput {
  name: string;
  description?: string;
  /** Pass a number of seconds, or null to clear the cadence. */
  intervalSeconds?: number | null;
  /** "#rrggbb" overrides for the staleness gradient ends, or null to clear. */
  colorFresh?: string | null;
  colorOverdue?: string | null;
  /** Pin the staleness colour to "fresh". */
  freezeColor?: boolean;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      // response had no JSON body; keep the generic message
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const httpApi = {
  listTasks: () => request<Task[]>("/api/tasks"),

  createTask: (input: TaskInput) =>
    request<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateTask: (id: number, input: TaskInput) =>
    request<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteTask: (id: number) =>
    request<void>(`/api/tasks/${id}`, { method: "DELETE" }),

  /** Soft-archive a task (hide it from the normal views, keep its history). */
  archiveTask: (id: number) =>
    request<Task>(`/api/tasks/${id}/archive`, { method: "POST" }),

  /** Restore a previously archived task. */
  unarchiveTask: (id: number) =>
    request<Task>(`/api/tasks/${id}/unarchive`, { method: "POST" }),

  /** Log a completion with an explicit time and/or note (the Advanced dialog). */
  completeTask: (id: number, input: { note?: string; completedAt?: string }) =>
    request<Completion>(`/api/tasks/${id}/complete`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Quick log: record "done right now" with no note (empty body). */
  quickComplete: (id: number) =>
    request<Completion>(`/api/tasks/${id}/complete`, { method: "POST" }),

  listCompletions: (id: number) =>
    request<Completion[]>(`/api/tasks/${id}/completions`),

  deleteCompletion: (id: number) =>
    request<void>(`/api/completions/${id}`, { method: "DELETE" }),

  /** Edit a logged completion's time and/or note. */
  updateCompletion: (id: number, input: { completedAt: string; note?: string }) =>
    request<Completion>(`/api/completions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  /** Cross-task completion feed for a date range (used by the calendar). */
  listActivity: (fromISO: string, toISO: string) =>
    request<Activity[]>(
      `/api/activity?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
    ),

  // --- auth ---

  authConfig: () => request<AuthConfig>("/api/auth/config"),

  /** Current user, or null if not signed in (a 401 is expected, not an error). */
  me: async (): Promise<User | null> => {
    try {
      return await request<User>("/api/auth/me");
    } catch {
      return null;
    }
  },

  login: (username: string, password: string) =>
    request<LoginResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  /** Set the first password on an admin-created (unclaimed) account and sign in. */
  claim: (username: string, password: string) =>
    request<User>("/api/auth/claim", { method: "POST", body: JSON.stringify({ username, password }) }),

  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  register: (username: string, password: string) =>
    request<User | PendingRegistration>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  // --- account self-service ---

  /** Rename your own account. */
  changeUsername: (username: string) =>
    request<User>("/api/me/username", { method: "POST", body: JSON.stringify({ username }) }),

  /** Remove your own OIDC link (refused if you have no password). */
  unlinkOIDC: () => request<User>("/api/me/oidc", { method: "DELETE" }),

  // --- reminders ---
  getReminders: () => request<ReminderSettings>("/api/me/reminders"),
  putReminders: (settings: ReminderSettings) =>
    request<ReminderSettings>("/api/me/reminders", { method: "PUT", body: JSON.stringify(settings) }),
  /** Send a sample webhook to verify delivery (tests `webhookUrl` if given, else the saved one). */
  testReminder: (webhookUrl?: string) =>
    request<{ ok: boolean }>("/api/me/reminders/test", {
      method: "POST",
      body: JSON.stringify({ webhookUrl: webhookUrl ?? "" }),
    }),

  /** Delete all your own tasks (keeps the account). Re-type your username to confirm. */
  wipeMyData: (confirm: string) =>
    request<{ deletedTasks: number }>("/api/me/wipe", {
      method: "POST",
      body: JSON.stringify({ confirm }),
    }),

  /** Delete your own account and everything it owns. Re-type your username to confirm. */
  deleteAccount: (confirm: string) =>
    request<void>("/api/me", { method: "DELETE", body: JSON.stringify({ confirm }) }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getPreferences: () => request<Record<string, unknown>>("/api/me/preferences"),

  putPreferences: (data: unknown) =>
    request<void>("/api/me/preferences", { method: "PUT", body: JSON.stringify(data) }),

  // --- admin ---

  listUsers: () => request<User[]>("/api/admin/users"),

  adminCreateUser: (input: { username: string; password?: string; role?: "admin" | "user" }) =>
    request<User>("/api/admin/users", { method: "POST", body: JSON.stringify(input) }),

  adminUpdateUser: (id: number, input: { role?: "admin" | "user"; password?: string }) =>
    request<User>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

  adminDeleteUser: (id: number) =>
    request<void>(`/api/admin/users/${id}`, { method: "DELETE" }),

  getSettings: () => request<AdminSettings>("/api/admin/settings"),

  putSettings: (patch: SettingsPatch) =>
    request<AdminSettings>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  /** Destructive: wipe all tasks and/or all non-admin users + their data. */
  adminWipe: (opts: { tasks?: boolean; users?: boolean; everything?: boolean }) =>
    request<{ ok: boolean; deletedUsers: number }>("/api/admin/wipe", {
      method: "POST",
      body: JSON.stringify({ ...opts, confirm: "WIPE" }),
    }),

  // --- approval queue ---
  listPending: () => request<User[]>("/api/admin/pending"),
  approveUser: (id: number, role?: "admin" | "user") =>
    request<User>(`/api/admin/users/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),

  /** Fold one account into another (move data + OIDC link, delete the source). */
  mergeUsers: (opts: { sourceId: number; targetId: number; moveData: boolean; newUsername?: string }) =>
    request<User>("/api/admin/merge", { method: "POST", body: JSON.stringify(opts) }),

  // --- sessions ---
  /** Who's currently signed in (per user: session count + last online). */
  listSessions: () => request<SessionSummary[]>("/api/admin/sessions"),
  /** Sign a user out everywhere by deleting all their sessions. */
  terminateSessions: (userId: number) =>
    request<void>(`/api/admin/sessions/${userId}`, { method: "DELETE" }),

  // --- logs ---
  /** Recent server/access logs. Pass the last seq seen to fetch only newer lines. */
  listLogs: (after = 0) => request<LogEntry[]>(`/api/admin/logs?after=${after}`),

  // --- site default theme ---
  setDefaultTheme: (theme: unknown) =>
    request<void>("/api/admin/default-theme", { method: "PUT", body: JSON.stringify(theme) }),

  // --- backups ---
  createBackup: () => request<{ name: string }>("/api/admin/backup", { method: "POST" }),
  listBackups: () => request<BackupInfo[]>("/api/admin/backups"),
  /** Direct download URL (used as an <a href>). */
  backupURL: (name: string) => `/api/admin/backups/${encodeURIComponent(name)}`,
  deleteBackup: (name: string) =>
    request<void>(`/api/admin/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),

  /** Restore from an existing backup. Takes a safety backup, then the server
   *  restarts and swaps the DB in on startup. */
  restoreBackup: (name: string) =>
    request<{ ok: boolean; safetyBackup: string }>(
      `/api/admin/restore/${encodeURIComponent(name)}`,
      { method: "POST" },
    ),

  /** Restore from an uploaded .db file (multipart, so not via `request`). */
  restoreUpload: async (file: File): Promise<{ ok: boolean; safetyBackup: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/restore-upload", { method: "POST", body: fd });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const d = await res.json();
        if (d && typeof d.error === "string") message = d.error;
      } catch {
        // no JSON body
      }
      throw new Error(message);
    }
    return res.json();
  },
};

/**
 * The shape every consumer talks to. The real client (`httpApi`) and the demo's
 * in-browser mock (`demoApi`) both implement it, so swapping transport happens
 * only here. `DEMO` is a compile-time literal, so a normal build inlines
 * `httpApi` and tree-shakes the demo module out entirely.
 */
export type Api = typeof httpApi;

export const api: Api = DEMO ? demoApi : httpApi;
