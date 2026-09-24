/**
 * [INPUT]: Depends on zod, the Dock layout/local-state models, Agent/usage identities, and the shared locale type.
 * [OUTPUT]: Provides the least-privilege bar/panel channels, snapshots, enumerated intents with strict validators, the isolated `systemDock` bridge type, and the main-window Settings → Dock channels, snapshot and bridge.
 * [POS]: shared/system-dock transport contract; auxiliary renderers receive projections and opaque short-lived references only, never paths, accounts, shell, AX or Apple Event senders (INV-13).
 */

import { z } from "zod";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { AgentBackendId } from "../agent-ipc";
import type { UsageSourceId } from "../usage-ipc";
import type { AgentUsageLimits } from "../usage-limits/types";
import { aiActivityWidgetSchema, aiLimitsWidgetSchema, SYSTEM_ENTRIES, type AiLimitsWidget, type DockLayout, type DockWidget, type SystemEntryId } from "./layout";
import { dockPreferencePatchSchema, type DockLocalState, type DockMode, type RecoveryRegistration, type ReplacementPhase, type SuspendReason } from "./local-state";
import type { MergeConflict } from "./merge";

/* ============================================================ bar / panel (isolated preload) */

export const SYSTEM_DOCK_CHANNEL = {
  snapshot: "system-dock:snapshot",
  changed: "system-dock:changed",
  intent: "system-dock:intent",
  icons: "system-dock:icons",
} as const;

export type TrashState = "empty" | "full" | "unknown";
export type LimitsFaceSource = Readonly<{ backend: AgentBackendId; remaining: number | null; windowMins: number | null; calendar: boolean;
  resetsAt: number | null; state: "ok" | "stale" | "loading" | "needs-auth" | "not-installed" | "unavailable" | "error" | "unknown" }>;
export type WidgetFace =
  | Readonly<{ type: "builtin.ai-limits"; configured: boolean; sources: readonly LimitsFaceSource[]; more: number }>
  | Readonly<{ type: "builtin.ai-activity"; state: "ok" | "partial" | "loading" | "no-data" | "error"; tokens: number | null;
      costUsd: number | null; unpricedTokens: number; todayKey: string | null; timeZone: string | null }>;
export type DockBarItem = Readonly<{
  id: string;
  kind: "native-app" | "bottega-app" | "system" | "widget";
  pinned: boolean;
  label: string;
  iconKey: string | null;
  running: boolean;
  status: "ok" | "missing" | "unavailable" | "needs-repair";
  entry?: SystemEntryId;
  trash?: TrashState;
  widget?: WidgetFace;
}>;
export type DockBarSnapshot = Readonly<{
  revision: number;
  locale: AppLocale;
  mode: DockMode;
  visibility: DockLocalState["visibility"];
  /** Bar content revealed (hover/keyboard/pinned); false leaves only the handle. */
  revealed: boolean;
  showHandle: boolean;
  scale: number;
  privacyMask: boolean;
  /** Only the items main fitted on screen (shared/system-dock/metrics fitItems); the rest are reachable through the overflow button. */
  pinned: readonly DockBarItem[];
  running: readonly DockBarItem[];
  overflow: number;
  reducedMotion: boolean;
  /** Item the panel currently serves, so a second click closes it (3.4). */
  panelTarget: string | null;
  busyItemId: string | null;
  /** Newly added item to scroll into view and highlight briefly (3.3). */
  highlightItemId?: string | null;
  empty: boolean;
  syncPending: boolean;
  /** macOS 15 renders a solid surface instead of translucency (5.6). */
  solidBackground?: boolean;
}>;
export type PanelView =
  | Readonly<{ kind: "detail"; itemId: string }>
  | Readonly<{ kind: "add" }>
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "navigate" }>;
export type DownloadEntry = Readonly<{ ref: string; name: string; kind: "file" | "directory" | "package"; modifiedAt: number; size: number | null }>;
export type DownloadsDetail = Readonly<{ state: "ok" | "partial" | "empty" | "denied" | "missing" | "error" | "loading"; entries: readonly DownloadEntry[] }>;
export type TrashDetail = Readonly<{ state: TrashState; emptying: boolean; automation: "unknown" | "granted" | "needs-prompt" | "denied" | "unavailable";
  lastResult: "none" | "emptied" | "partial" | "failed" | "unknown" | "denied" | "cancelled" }>;
export type AddCandidate = Readonly<{ key: string; kind: "native-app" | "bottega-app" | "system" | "widget"; label: string; iconKey: string | null;
  pinned: boolean; group: "native" | "bottega" | "system" | "widget"; note?: "unavailable" | "needs-repair" }>;
export type PanelSnapshot = Readonly<{
  revision: number;
  locale: AppLocale;
  view: PanelView | null;
  focused: boolean;
  mode?: DockMode;
  solidBackground?: boolean;
  privacyMask: boolean;
  items: readonly DockBarItem[];
  downloads: DownloadsDetail | null;
  trash: TrashDetail | null;
  /** Limits detail in selection order; `configurable` is what the Bottega service confirms it can read (3.4). */
  limits: Readonly<{ itemId: string; agents: readonly AgentUsageLimits[]; selected: readonly AgentBackendId[]; configurable: readonly AgentBackendId[];
    selection: AiLimitsWidget["selectionByBackend"]; updatedAt: number | null; refreshing: boolean }> | null;
  activity: Readonly<{ itemId: string; source: "all" | UsageSourceId; sources: readonly UsageSourceId[]; face: Extract<WidgetFace, { type: "builtin.ai-activity" }>;
    scannedFiles: number; issues: number; updatedAt: number | null }> | null;
  candidates: readonly AddCandidate[] | null;
  undo: Readonly<{ label: string }> | null;
  /** `stale`: the applied Widget changed (e.g. on another Mac) since this draft began; Apply then needs `force`. */
  draft: Readonly<{ itemId: string; widget: DockWidget; stale?: boolean }> | null;
}>;

const itemId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const shortRef = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const dockIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hover"), inside: z.boolean() }).strict(),
  z.object({ kind: z.literal("activate"), itemId }).strict(),
  z.object({ kind: z.literal("context-menu"), itemId: itemId.nullable() }).strict(),
  z.object({ kind: z.literal("open-panel"), view: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("detail"), itemId }).strict(),
    z.object({ kind: z.literal("add") }).strict(),
    z.object({ kind: z.literal("edit") }).strict(),
    z.object({ kind: z.literal("navigate") }).strict(),
  ]) }).strict(),
  z.object({ kind: z.literal("close-panel"), restoreFocus: z.boolean() }).strict(),
  z.object({ kind: z.literal("open-download"), ref: shortRef }).strict(),
  z.object({ kind: z.literal("reveal-downloads") }).strict(),
  z.object({ kind: z.literal("open-finder") }).strict(),
  z.object({ kind: z.literal("empty-trash"), confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("request-automation") }).strict(),
  z.object({ kind: z.literal("add"), key: z.string().min(1).max(600) }).strict(),
  z.object({ kind: z.literal("add-app-file") }).strict(),
  z.object({ kind: z.literal("remove"), itemId }).strict(),
  z.object({ kind: z.literal("undo") }).strict(),
  z.object({ kind: z.literal("move"), itemId, index: z.number().int().min(0).max(200) }).strict(),
  z.object({ kind: z.literal("pin-running"), itemId }).strict(),
  /* `base` is the applied Widget the editor opened with; conflicts are judged against it, not against whatever main holds
     when the first change arrives (a remote edit can land in between). */
  z.object({ kind: z.literal("widget-draft"), itemId, widget: z.union([aiLimitsWidgetSchema, aiActivityWidgetSchema]),
    base: z.union([aiLimitsWidgetSchema, aiActivityWidgetSchema]).optional() }).strict(),
  z.object({ kind: z.literal("widget-apply"), itemId, force: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("widget-cancel"), itemId }).strict(),
  z.object({ kind: z.literal("refresh-usage"), itemId }).strict(),
  z.object({ kind: z.literal("open-full-usage"), backend: z.string().max(32).nullable() }).strict(),
  z.object({ kind: z.literal("open-settings") }).strict(),
  z.object({ kind: z.literal("restore-system-dock") }).strict(),
  z.object({ kind: z.literal("search"), query: z.string().max(200) }).strict(),
]);
export type DockIntent = z.infer<typeof dockIntentSchema>;
export type SystemDockBridge = {
  role: "bar" | "panel";
  snapshot(): Promise<DockBarSnapshot | PanelSnapshot>;
  intent(intent: DockIntent): Promise<void>;
  icons(keys: readonly string[]): Promise<Record<string, string>>;
  onChanged(listener: (snapshot: DockBarSnapshot | PanelSnapshot) => void): () => void;
};

/* ============================================================ Settings → Dock (product preload, main role only) */

export const SYSTEM_DOCK_SETTINGS_CHANNEL = {
  snapshot: "system-dock-settings:snapshot",
  changed: "system-dock-settings:changed",
  beginSetup: "system-dock-settings:begin-setup",
  confirmSetup: "system-dock-settings:confirm-setup",
  cancelSetup: "system-dock-settings:cancel-setup",
  importCandidates: "system-dock-settings:import-candidates",
  confirmImport: "system-dock-settings:confirm-import",
  setPreference: "system-dock-settings:set-preference",
  setMode: "system-dock-settings:set-mode",
  disable: "system-dock-settings:disable",
  restoreSystemDock: "system-dock-settings:restore",
  resume: "system-dock-settings:resume",
  resetLayout: "system-dock-settings:reset-layout",
  resolveConflict: "system-dock-settings:resolve-conflict",
  openRecoverySettings: "system-dock-settings:open-recovery-settings",
} as const;

export type DockCapability = Readonly<{
  supported: boolean;
  /** Replacement also needs a packaged build with the bundled recovery agent (5.5/5.6). */
  replacement: boolean;
  reason: "platform" | "os-version" | "architecture" | "development" | "helper-missing" | null;
}>;
export type ImportCandidate = Readonly<{ key: string; label: string; bundleIdentifier: string | null; iconKey: string | null;
  status: "ok" | "unresolved" | "unsupported"; note: "recent-apps" | "file" | "url" | "spacer" | "managed" | "unknown" | null; preselected: boolean }>;
export type DockSetupPreview = Readonly<{
  sessionId: string;
  mode: DockMode;
  layoutExists: boolean;
  layoutRevision: number;
  candidates: readonly ImportCandidate[];
  readFailure: "unavailable" | "managed" | "unknown" | null;
  preview: DockLayout;
}>;
export type DockSyncStatus = Readonly<{
  state: "local-only" | "synced" | "pending" | "offline" | "conflict" | "blocked" | "error";
  conflict: Readonly<{ kind: "first-sync" | "three-way" | "unsupported"; conflicts: readonly MergeConflict[] }> | null;
}>;
export type DockSettingsSnapshot = Readonly<{
  revision: number;
  capability: DockCapability;
  state: DockLocalState;
  actualMode: DockMode | null;
  phase: ReplacementPhase;
  suspendReason: SuspendReason | null;
  registration: RecoveryRegistration | "unsupported";
  recovery: Readonly<{ pending: boolean; lastResult: "none" | "restored" | "kept-external" | "failed" }>;
  layoutInitialized: boolean;
  itemCount: number;
  sync: DockSyncStatus;
  accessibility: "granted" | "not-granted" | "unsupported";
}>;
export const setupConfirmSchema = z.object({ sessionId: z.string().min(8).max(64), mode: z.enum(["replace", "coexist"]),
  selected: z.array(z.string().min(1).max(600)).max(100), acknowledged: z.boolean() }).strict();
export const importConfirmSchema = z.object({ sessionId: z.string().min(8).max(64), selected: z.array(z.string().min(1).max(600)).max(100) }).strict();
export const conflictChoiceSchema = z.object({ strategy: z.enum(["merge", "remote", "local"]), choices: z.array(z.enum(["local", "remote"])).max(256) }).strict();
export { dockPreferencePatchSchema };
export type SetupConfirm = z.infer<typeof setupConfirmSchema>;
export type ConflictChoice = z.infer<typeof conflictChoiceSchema>;
export type SystemDockSettingsBridge = {
  snapshot(): Promise<DockSettingsSnapshot>;
  onChanged(listener: (snapshot: DockSettingsSnapshot) => void): () => void;
  beginSetup(mode: DockMode): Promise<DockSetupPreview>;
  confirmSetup(input: SetupConfirm): Promise<DockSettingsSnapshot>;
  cancelSetup(sessionId: string): Promise<void>;
  importCandidates(): Promise<DockSetupPreview>;
  confirmImport(input: z.infer<typeof importConfirmSchema>): Promise<DockSettingsSnapshot>;
  setPreference(patch: z.infer<typeof dockPreferencePatchSchema>): Promise<DockSettingsSnapshot>;
  setMode(mode: DockMode): Promise<DockSettingsSnapshot>;
  disable(): Promise<DockSettingsSnapshot>;
  restoreSystemDock(): Promise<DockSettingsSnapshot>;
  resume(): Promise<DockSettingsSnapshot>;
  resetLayout(): Promise<DockSettingsSnapshot>;
  resolveConflict(choice: ConflictChoice): Promise<DockSettingsSnapshot>;
  openRecoverySettings(): Promise<void>;
};
export const SYSTEM_ENTRY_IDS: readonly SystemEntryId[] = SYSTEM_ENTRIES;
