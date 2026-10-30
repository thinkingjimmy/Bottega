/**
 * [INPUT]: Depends on Zod, Dock layout/local state, narrow Widget quick entries, task/Agent/usage identities and the shared locale type; host form contracts are type-only dependencies.
 * [OUTPUT]: Provides least-privilege Dock channels, pathless download visuals, task face/detail snapshots and identity-fenced Chat opening, validated intents including placement-fenced drag removal, isolated bridges and the main-window Settings contract. Includes strict App pin intents, pinned App IDs and live App emoji.
 * [POS]: shared/system-dock transport contract; auxiliary renderers receive projections and opaque short-lived references only, never paths, accounts, shell, AX or Apple Event senders (INV-13).
 */
import type {WidgetApiControl,WidgetApiReview} from './widgets/api/control';

import { z } from "zod";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { AgentBackendId } from "../ipc/agent/agent-ipc";
import type { TaskActivitySnapshot, PresenceTask } from "../ipc/agent/presence-ipc";
import type { UsageSourceId } from "../ipc/settings/usage-ipc";
import type { AgentUsageLimits } from "../usage-limits/types";
import { aiActivityWidgetSchema, aiLimitsWidgetSchema, tasksWidgetSchema, type AiLimitsWidget, type DockLayout, type DockWidget, type SystemEntryId } from "./layout";
import { dockPreferencePatchSchema, type DockLocalState, type DockMode, type RecoveryRegistration, type ReplacementPhase, type SuspendReason } from "./local-state";
import type { MergeConflict } from "./merge";
import type { DockDisplay, DockPlacementStatus } from "./displays";
import type {WidgetAuthoringTarget,WidgetManagementSnapshot,WidgetPreview,WidgetApplyInput,WidgetApplyReceipt,WidgetVersionView,newDockWidgetSchema,editDockWidgetSchema,forkDockWidgetSchema,previewWidgetVersionSchema} from './widgets/authoring';
import type {CustomWidgetFace,CustomWidgetDetail} from './widgets/runtime';
import type {WidgetInstanceForm,WidgetInstanceReceipt,widgetInstancePauseSchema,widgetInstanceRemoveSchema,widgetBaseRevokeSchema} from './widgets/management';
import {dockWidgetEntrySchema} from './widgets/entry';
import type {OfficialWidgetForm,SubmitOfficialWidget,officialWidgetQuerySchema} from './widgets/official';
import type {WidgetRuntimeHealth} from './widgets/native';
import type {WidgetBaseDirectory,WidgetBaseDirectoryRequest} from './widgets/base/access';
import type {WidgetUpdateReview,StageWidgetUpdate} from './widgets/review';
import type {WidgetPreviewControl,WidgetPreviewResult,WidgetPreviewSnapshot} from './widgets/preview/contracts';

/* ============================================================ bar / panel (isolated preload) */

export const SYSTEM_DOCK_CHANNEL = {
  snapshot: "system-dock:snapshot",
  changed: "system-dock:changed",
  intent: "system-dock:intent",
  icons: "system-dock:icons",
  downloadVisual: "system-dock:download-visual",
} as const;

export type TrashState = "empty" | "full" | "unknown";
export type LimitsFaceSource = Readonly<{ backend: AgentBackendId; remaining: number | null; windowMins: number | null; calendar: boolean;
  resetsAt: number | null; state: "ok" | "stale" | "loading" | "needs-auth" | "not-installed" | "unavailable" | "error" | "unknown" }>;
export type DockTaskReference = Pick<PresenceTask, "chatId" | "incarnationId" | "requestId" | "generation">;
export type DockTasksDetail = Readonly<{ activity: TaskActivitySnapshot; workflowLabels?: Partial<Record<"plan" | "develop" | "review", string>> }>;
export type WidgetFace =
  | CustomWidgetFace
  | Readonly<{ type: "builtin.tasks"; running: number | null; waiting: number | null; result: TaskActivitySnapshot["result"] }>
  | Readonly<{ type: "builtin.ai-limits"; configured: boolean; sources: readonly LimitsFaceSource[]; more: number }>
  | Readonly<{ type: "builtin.ai-activity"; state: "ok" | "partial" | "loading" | "no-data" | "error"; tokens: number | null;
      costUsd: number | null; unpricedTokens: number; todayKey: string | null; timeZone: string | null }>;
export type DockBarItem = Readonly<{
  id: string;
  kind: "native-app" | "bottega-app" | "system" | "widget";
  pinned: boolean;
  /** The current Bottega process uses product branding and its own activation/quit lifecycle. */
  host?: boolean;
  label: string;
  iconKey: string | null;
  appIcon?: string | null;
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
  edge: DockLocalState["edge"];
  placementRevision: number;
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
export type DownloadVisual = Readonly<{ kind: "thumbnail" | "icon"; dataUrl: string }>;
export const downloadVisualRequestSchema = z.object({ ref: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), size: z.enum(["thumbnail", "preview"]) }).strict();
export type DownloadVisualRequest = z.infer<typeof downloadVisualRequestSchema>;
export type TrashDetail = Readonly<{ state: TrashState; emptying: boolean; automation: "unknown" | "granted" | "needs-prompt" | "denied" | "unavailable";
  lastResult: "none" | "emptied" | "partial" | "failed" | "unknown" | "denied" | "cancelled" }>;
export type AddCandidate = Readonly<{ key: string; kind: "native-app" | "bottega-app" | "system" | "widget"; label: string; iconKey: string | null;
  appIcon?: string | null; pinned: boolean; group: "native" | "bottega" | "system" | "widget"; note?: "unavailable" | "needs-repair" }>;
export type PanelSnapshot = Readonly<{
  revision: number;
  locale: AppLocale;
  view: PanelView | null;
  focused: boolean;
  mode?: DockMode;
  solidBackground?: boolean;
  privacyMask: boolean;
  items: readonly DockBarItem[];
  tasks?: DockTasksDetail | null;
  customWidget?:CustomWidgetDetail|null;
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
const placementRevision = z.number().int().nonnegative();
const shortRef = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const dockIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hover"), inside: z.boolean(), placementRevision: placementRevision.optional() }).strict(),
  z.object({ kind: z.literal("layout-ready"), placementRevision }).strict(),
  z.object({ kind: z.literal("activate"), itemId, placementRevision: placementRevision.optional() }).strict(),
  z.object({ kind: z.literal("context-menu"), itemId: itemId.nullable(), placementRevision: placementRevision.optional() }).strict(),
  z.object({ kind: z.literal("open-panel"), placementRevision: placementRevision.optional(), view: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("detail"), itemId }).strict(),
    z.object({ kind: z.literal("add") }).strict(),
    z.object({ kind: z.literal("edit") }).strict(),
    z.object({ kind: z.literal("navigate") }).strict(),
  ]) }).strict(),
  z.object({ kind: z.literal("close-panel"), restoreFocus: z.boolean() }).strict(),
  z.object({ kind: z.literal("focus-panel") }).strict(),
  z.object({ kind: z.literal("open-download"), ref: shortRef }).strict(),
  z.object({ kind: z.literal("reveal-download"), ref: shortRef }).strict(),
  z.object({ kind: z.literal("reveal-downloads") }).strict(),
  z.object({ kind: z.literal("open-finder") }).strict(),
  z.object({ kind: z.literal("empty-trash"), confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal("request-automation") }).strict(),
  z.object({ kind: z.literal("add"), key: z.string().min(1).max(600) }).strict(),
  z.object({ kind: z.literal("add-app-file") }).strict(),
  z.object({kind:z.literal('widget-entry'),entry:dockWidgetEntrySchema}).strict(),
  z.object({kind:z.literal('widget-detail-slot'),itemId,key:z.string().regex(/^[a-f0-9]{64}$/),bounds:z.object({x:z.number().finite().min(-4096).max(4096),y:z.number().finite().min(-4096).max(4096),width:z.number().finite().positive().max(4096),height:z.number().finite().positive().max(4096)}).strict()}).strict(),
  z.object({kind:z.literal('widget-detail-retry'),itemId,key:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({kind:z.literal('widget-action'),itemId,ref:z.string().regex(/^[a-f0-9]{32}$/)}).strict(),
  z.object({ kind: z.literal("remove"), itemId, placementRevision: placementRevision.optional() }).strict(),
  z.object({ kind: z.literal("undo") }).strict(),
  z.object({ kind: z.literal("move"), itemId, placementRevision: placementRevision.optional(), index: z.number().int().min(0).max(200) }).strict(),
  z.object({ kind: z.literal("pin-running"), itemId, placementRevision: placementRevision.optional() }).strict(),
  /* `base` is the applied Widget the editor opened with; conflicts are judged against it, not against whatever main holds
     when the first change arrives (a remote edit can land in between). */
  z.object({ kind: z.literal("widget-draft"), itemId, widget: z.union([aiLimitsWidgetSchema, aiActivityWidgetSchema, tasksWidgetSchema]),
    base: z.union([aiLimitsWidgetSchema, aiActivityWidgetSchema, tasksWidgetSchema]).optional() }).strict(),
  z.object({ kind: z.literal("widget-apply"), itemId, force: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("widget-cancel"), itemId }).strict(),
  z.object({ kind: z.literal("refresh-usage"), itemId }).strict(),
  z.object({ kind: z.literal("open-full-usage"), backend: z.string().max(32).nullable() }).strict(),
  z.object({ kind: z.literal("open-settings") }).strict(),
  z.object({ kind: z.literal("open-main") }).strict(),
  z.object({ kind: z.literal("open-task"), task: z.object({ chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(256), generation: z.number().int().nonnegative() }).strict() }).strict(),
  z.object({ kind: z.literal("restore-system-dock") }).strict(),
  z.object({ kind: z.literal("search"), query: z.string().max(200) }).strict(),
]);
export type DockIntent = z.infer<typeof dockIntentSchema>;
export type SystemDockBridge = {
  role: "bar" | "panel";
  snapshot(): Promise<DockBarSnapshot | PanelSnapshot>;
  intent(intent: DockIntent): Promise<void>;
  icons(keys: readonly string[]): Promise<Record<string, string>>;
  downloadVisual(input: DownloadVisualRequest): Promise<DownloadVisual | null>;
  onChanged(listener: (snapshot: DockBarSnapshot | PanelSnapshot) => void): () => void;
};

/* ============================================================ Settings → Dock (product preload, main role only) */

export { SYSTEM_DOCK_SETTINGS_CHANNEL } from "../ipc-channels/window";

export type DockCapability = Readonly<{
  supported: boolean;
  /** Main verifies the signed installation before admitting replacement; recovery is independent. */
  replacement: boolean;
  reason: "platform" | "os-version" | "architecture" | "development" | "helper-missing" | "checking" | "signature-unverified" | null;
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
  displays: readonly DockDisplay[];
  placement: DockPlacementStatus;
  /** A requested panel could not fit; Settings offers another display or a smaller Dock. */
  panelSpaceUnavailable?: boolean;
  actualMode: DockMode | null;
  phase: ReplacementPhase;
  suspendReason: SuspendReason | null;
  registration: RecoveryRegistration | "unsupported" | "unknown";
  recovery: Readonly<{ pending: boolean; lastResult: "none" | "restored" | "kept-external" | "failed" }>;
  layoutInitialized: boolean;
  itemCount: number;
  pinnedAppIds: readonly string[];
  sync: DockSyncStatus;
  accessibility: "granted" | "not-granted" | "unsupported";
  automation: TrashDetail["automation"];
}>;
export const setAppPinnedSchema = z.object({ appId: z.string().min(1).max(256), pinned: z.boolean() }).strict();
export type SetAppPinned = z.infer<typeof setAppPinnedSchema>;
export const setupConfirmSchema = z.object({ sessionId: z.string().min(8).max(64), mode: z.enum(["replace", "coexist"]),
  selected: z.array(z.string().min(1).max(600)).max(100), acknowledged: z.boolean() }).strict();
export const importConfirmSchema = z.object({ sessionId: z.string().min(8).max(64), selected: z.array(z.string().min(1).max(600)).max(100) }).strict();
export const conflictChoiceSchema = z.object({ strategy: z.enum(["merge", "remote", "local"]), choices: z.array(z.enum(["local", "remote"])).max(256) }).strict();
export { dockPreferencePatchSchema };
export type SetupConfirm = z.infer<typeof setupConfirmSchema>;
export type ConflictChoice = z.infer<typeof conflictChoiceSchema>;
export type SystemDockSettingsBridge = {
  widgetInstallReview(input:{itemId:string}):Promise<import('./widgets/install/types').WidgetInstallReview>;
  confirmWidgetInstall(input:{operationId:string;reviewId:string}):Promise<import('./widgets/install/types').WidgetInstallResult>;
  widgetInstallOperation(input:{operationId:string}):Promise<import('./widgets/install/types').WidgetInstallResult|null>;
  retryWidgetInstall(input:{operationId:string}):Promise<import('./widgets/install/types').WidgetInstallResult>;
  cancelWidgetInstall(input:{operationId:string}):Promise<import('./widgets/install/types').WidgetInstallResult>;
  widgetLifecycleControl(input:import('./widgets/install/lifecycle').WidgetLifecycleControl):Promise<import('./widgets/install/lifecycle').WidgetLifecycleResult>;
  widgetDeliveryControl(input:{reference:string;action:'retry'|'abandon'}):Promise<void>;

  widgetPreviewControl(input:WidgetPreviewControl):Promise<WidgetPreviewResult>;
  onWidgetPreviewChanged(listener:(snapshot:WidgetPreviewSnapshot)=>void):()=>void;
  widgetSnapshot():Promise<WidgetManagementSnapshot>;
  widgetHealth():Promise<WidgetRuntimeHealth>;
  widgetApiControl(input:WidgetApiControl):Promise<WidgetApiReview>;
  widgetBaseDirectory(input:WidgetBaseDirectoryRequest):Promise<WidgetBaseDirectory>;
  revokeWidgetBaseAccess(input:z.infer<typeof widgetBaseRevokeSchema>):Promise<WidgetInstanceReceipt>;
  widgetUpdateReview(input:{previewId:string}):Promise<WidgetUpdateReview>;
  widgetUpdateForm(input:{previewId:string;itemId:string}):Promise<WidgetInstanceForm>;
  stageWidgetUpdate(input:StageWidgetUpdate):Promise<WidgetUpdateReview>;
  onWidgetsChanged(listener:()=>void):()=>void;
  newWidget(input:z.infer<typeof newDockWidgetSchema>):Promise<WidgetAuthoringTarget>;
  editWidget(input:z.infer<typeof editDockWidgetSchema>):Promise<WidgetAuthoringTarget>;
  forkWidget(input:z.infer<typeof forkDockWidgetSchema>):Promise<WidgetAuthoringTarget>;
  buildWidget(input:z.infer<typeof editDockWidgetSchema>):Promise<WidgetPreview>;
  instancePreview(input:{itemId:string}):Promise<WidgetInstanceForm>;
  savedWidgetPreview(input:{definitionId:string;sourceInstallationId?:string}):Promise<WidgetInstanceForm>;
  submitWidgetInstance(input:WidgetApplyInput):Promise<WidgetInstanceReceipt>;
  officialWidgetPreview(input:z.infer<typeof officialWidgetQuerySchema>):Promise<OfficialWidgetForm>;
  submitOfficialWidget(input:SubmitOfficialWidget):Promise<WidgetInstanceReceipt>;
  setWidgetPaused(input:z.infer<typeof widgetInstancePauseSchema>):Promise<WidgetInstanceReceipt>;
  removeWidgetInstance(input:z.infer<typeof widgetInstanceRemoveSchema>):Promise<WidgetInstanceReceipt>;
  widgetPreview(input:z.infer<typeof editDockWidgetSchema>):Promise<WidgetPreview>;
  widgetVersions(input:z.infer<typeof editDockWidgetSchema>):Promise<readonly WidgetVersionView[]>;
  previewWidgetVersion(input:z.infer<typeof previewWidgetVersionSchema>):Promise<WidgetPreview>;
  applyWidget(input:WidgetApplyInput):Promise<WidgetApplyReceipt>;
  widgetOperation(input:{operationId:string}):Promise<WidgetApplyReceipt|null>;
  snapshot(): Promise<DockSettingsSnapshot>;
  onChanged(listener: (snapshot: DockSettingsSnapshot) => void): () => void;
  beginSetup(mode: DockMode): Promise<DockSetupPreview>;
  confirmSetup(input: SetupConfirm): Promise<DockSettingsSnapshot>;
  cancelSetup(sessionId: string): Promise<void>;
  importCandidates(): Promise<DockSetupPreview>;
  confirmImport(input: z.infer<typeof importConfirmSchema>): Promise<DockSettingsSnapshot>;
  setAppPinned(input: SetAppPinned): Promise<DockSettingsSnapshot>;
  setPreference(patch: z.infer<typeof dockPreferencePatchSchema>): Promise<DockSettingsSnapshot>;
  setMode(mode: DockMode): Promise<DockSettingsSnapshot>;
  disable(): Promise<DockSettingsSnapshot>;
  restoreSystemDock(): Promise<DockSettingsSnapshot>;
  resume(): Promise<DockSettingsSnapshot>;
  resetLayout(): Promise<DockSettingsSnapshot>;
  resolveConflict(choice: ConflictChoice): Promise<DockSettingsSnapshot>;
  openRecoverySettings(): Promise<void>;
};
