/**
 * [INPUT]: Depends on Agent backend identities and the shared locale type.
 * [OUTPUT]: Provides independent menu bar/background preferences, retryable effective states, task/receipt identities and readonly activity for the Dock.
 * [POS]: apps/desktop/shared/ipc/agent; Shared presence and task transport for main, product preload and the Dock.
 */

import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";


export type PresenceStatus = "disabled" | "pending" | "enabled" | "blocked" | "failed" | "unsupported";
export type PresenceReason = "platform" | "development" | "approval" | "system-disabled" | "login-failed" |
  "save-failed" | "tray-unavailable" | null;
export type EffectivePresence = Readonly<{ status: PresenceStatus; reason: PresenceReason; retryTarget?: boolean }>;
export type PresenceSnapshot = Readonly<{
  quitting?: boolean;
  revision: number;
  preferenceRevision: number;
  preferences: Readonly<{ launchAtLogin: boolean; keepRunningInBackground: boolean; showInMenuBar: boolean }>;
  capabilities: Readonly<{ background: boolean; menuBar: boolean }>;
  login: EffectivePresence;
  retention: EffectivePresence;
  menuBar: EffectivePresence;
}>;
export type PresenceObservation = Readonly<{
  adapter: "macos" | "recording" | "unsupported";
  systemWrites: number;
  lastRead: Readonly<{ enabled: boolean; approval: boolean; wasOpenedAtLogin: boolean }> | null;
  calls: readonly Readonly<{ operation: "read" | "write"; enabled?: boolean }>[];
}>;
export type TaskPhase = "preparing" | "running" | "approval" | "answer" | "finishing" | "recovery" | "completed" | "cancelled" | "failed";
export type TaskReference = Readonly<{ chatId: string; incarnationId: string }>;
export type PresenceTask = TaskReference & Readonly<{
  requestId: string; generation: number; backend: ProviderId;
  title: string | null; context: string | null; startedAt: number | null;
  phase: TaskPhase; subtaskCount: number;
  /** A workflow step's turn (a role's, not the person's): its run (the parent), step and role; absent for every other turn. */
  workflow?: Readonly<{ runId: string; stepId: string; role: import("@ai-chat/cloud-protocol/contracts/workflow/recipe").WorkflowRoleName }>;
}>;
export type TaskActivitySnapshot = Readonly<{
  version: 1; revision: number; tasks: readonly PresenceTask[];
  total: number; running: number; waiting: number; overflow: number;
  result: "completed" | "cancelled" | "ended" | "failed" | null;
}>;
export const PRESENCE_CHANNEL = {
  snapshot: "presence:snapshot", changed: "presence:changed", refresh: "presence:refresh",
  setLaunchAtLogin: "presence:set-launch-at-login", setWindowRetention: "presence:set-window-retention",
  setMenuBar: "presence:set-menu-bar",
  openSystemSettings: "presence:open-system-settings", observe: "presence:observe",
  presented: "presence:presented", consumed: "presence:consumed",
} as const;
export type TerminalIdentity = Readonly<{ requestId: string; generation: number; terminalSeq: number; sourceId?: string }>;
export type PresentedChat = TaskReference & TerminalIdentity;
export type PresenceBridge = {
  snapshot(): Promise<PresenceSnapshot>;
  refresh(): Promise<PresenceSnapshot>;
  setLaunchAtLogin(enabled: boolean): Promise<PresenceSnapshot>;
  setWindowRetention(enabled: boolean): Promise<PresenceSnapshot>;
  setMenuBar(enabled: boolean): Promise<PresenceSnapshot>;
  openSystemSettings(): Promise<void>;
  observe(): Promise<PresenceObservation>;
  presented(value: PresentedChat | null): Promise<void>;
  onChanged(listener: (snapshot: PresenceSnapshot) => void): () => void;
  onConsumed(listener: (receipt: PresentedChat) => void): () => void;
};
