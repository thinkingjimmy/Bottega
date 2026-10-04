/**
 * [INPUT]: Depends on Agent backend identities and the shared locale type.
 * [OUTPUT]: Provides icon/notch selection, platform and screen capabilities, actual entry availability, typed display retry targets, and versioned presence with task/receipt identities (a workflow step's task marked with its role), observations, manual panel opening, shortcut availability, and least-privilege panel contracts with shared expansion state and a native menu intent.
 * [POS]: apps/desktop/shared/ipc/agent; Shared transport contract for main, product preload, and the isolated task panel.
 */

import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";


export type PresenceStatus = "disabled" | "pending" | "enabled" | "blocked" | "failed" | "unsupported";
export type PresenceReason = "platform" | "development" | "approval" | "system-disabled" | "login-failed" |
  "shortcut-unavailable" | "save-failed" | "tray-unavailable" | "panel-unavailable" | "screen-unavailable" | "native-unavailable" | "no-notch" | null;
export type PresenceDisplayMode = "icon" | "notch";
export type NotchCapability = Readonly<{ status: "checking" | "available" | "unavailable"; reason: PresenceReason }>;
export type EffectiveDisplayPresence = Readonly<{ status: PresenceStatus; reason: PresenceReason; retryTarget?: PresenceDisplayMode }>;
export type EffectivePresence = Readonly<{ status: PresenceStatus; reason: PresenceReason; retryTarget?: boolean }>;
export type PresenceSnapshot = Readonly<{
  quitting?: boolean;
  revision: number;
  preferenceRevision: number;
  preferences: Readonly<{ launchAtLogin: boolean; keepRunningInBackground: boolean; showTaskStatusAtTop: boolean }>;
  capabilities: Readonly<{ background: boolean; displayModeSelection: boolean; notch: NotchCapability }>;
  effectiveDisplayMode: PresenceDisplayMode | null;
  display: EffectiveDisplayPresence;
  login: EffectivePresence;
  retention: EffectivePresence;
  top: EffectivePresence;
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
  setDisplayMode: "presence:set-display-mode",
  openPanel: "presence:open-panel", togglePanel: "presence:toggle-panel",
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
  setDisplayMode(mode: PresenceDisplayMode): Promise<PresenceSnapshot>;
  openPanel(): Promise<void>;
  togglePanel(): Promise<void>;
  openSystemSettings(): Promise<void>;
  observe(): Promise<PresenceObservation>;
  presented(value: PresentedChat | null): Promise<void>;
  onChanged(listener: (snapshot: PresenceSnapshot) => void): () => void;
  onConsumed(listener: (receipt: PresentedChat) => void): () => void;
};

export const PANEL_CHANNEL = { snapshot: "presence-panel:snapshot", changed: "presence-panel:changed", intent: "presence-panel:intent" } as const;
export type TaskPanelSnapshot = Readonly<{ activity: TaskActivitySnapshot; expanded: boolean; panelOpen: boolean; segment: "left" | "right" | "full"; locale: import("@ai-chat/ui/lib/locale").AppLocale;
  /** A workflow step's marker per role in the panel's language ("Workflow · Developer"), resolved in main; absent until loaded. */
  workflowLabels?: Readonly<Record<import("@ai-chat/cloud-protocol/contracts/workflow/recipe").WorkflowRoleName, string>> }>;
/** `prewarm`: the pointer is over the strip, so the expanded list is created ahead of the click (C-11). */
export type TaskPanelIntent = { kind: "expand" | "collapse" | "menu" | "open-main" | "open-settings" | "prewarm" } | { kind: "open-task"; task: TaskReference };
export type TaskPanelBridge = Readonly<{
  snapshot(): Promise<TaskPanelSnapshot>;
  intent(intent: TaskPanelIntent): Promise<void>;
  onChanged(listener: (snapshot: TaskPanelSnapshot) => void): () => void;
}>;
