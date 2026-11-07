/**
 * [INPUT]: Unified plugin lifecycle/manifest contracts and the main-owned common path-policy scope.
 * [OUTPUT]: Prepared runtime/profile-policy ports, exact-owner or explicit whole-plugin revocation, guarded recovery/source receipts, original feature-state capture and the main-only superseded-build signal.
 * [POS]: Main-only orchestration boundary; process, source and Surface owners inject their existing executors.
 */
import type {
  PluginReadiness, PluginServiceContext, PluginServiceRuntime, UnifiedPluginManifest, UnifiedPluginRevision,
  PluginPrepareAuthoringInput, PluginPrepareAuthoringResult,
} from "@bottega/contracts/plugins/platform";

import type { PluginPathScope } from "../process/paths";

export class PluginSourceSupersededError extends Error {
  constructor() { super("Plugin source build was superseded"); this.name = "PluginSourceSupersededError"; }
}

export type PluginOperationOptions = Readonly<{ signal?: AbortSignal; assertCurrent?(): void }>;
export type PluginSourceBuild = Readonly<{ sourceDirectory: string; sourceDigest: string; revisionId: string }>;
export type PluginActivationOptions = PluginOperationOptions & Readonly<{ restore?: boolean; startup?: boolean; builtSource?: Omit<PluginSourceBuild, "revisionId"> }>;
export type PluginEnablementRequest = Readonly<{
  pluginId: string; enabled: boolean;
  /** Called under the original owner queue before mutation; recovery guards and captures compensation state here. */
  capturePrevious?(enabled: boolean): void;
}>;
export type PreparedPluginRuntime = Omit<PluginServiceRuntime, "prepare"> & Readonly<{ readiness: PluginReadiness[] }>;
export type PluginCandidateContext = Readonly<{ revision: UnifiedPluginRevision; manifest: UnifiedPluginManifest; activationId: string; signal: AbortSignal }>;
export type UnifiedPluginPlatformOptions = Readonly<{
  userData: string;
  /** Main-owned profile policy; renderer declarations cannot choose a scope. */
  sourcePathScope?: PluginPathScope;
  now?: () => number;
  startupWindowMs?: number;
  /** Delegates explicit feature switches, never ordinary revision prepare/drain. */
  applyEnablement?(input: PluginEnablementRequest): Promise<void>;
  featureReady?(pluginId: string): boolean;
  authoringWaiters?(pluginId: string): readonly string[];
  prepareRuntime?(input: PluginCandidateContext): Promise<PreparedPluginRuntime>;
  /** Checks every UI contribution through the isolated Surface owner, including plugins with no service. */
  prepareUi?(input: PluginCandidateContext): Promise<PluginReadiness[]>;
  /** Closes one captured owner, or explicitly all leases during plugin disable/shutdown. */
  revokeContributions?(input: { pluginId: string } & PluginRevocationScope): Promise<void>;
  restoreSource?(revision: UnifiedPluginRevision, options?: PluginOperationOptions): Promise<void>;
  openFolder?(pluginId: string): Promise<void>;
  prepareAuthoring?(input: PluginPrepareAuthoringInput): Promise<PluginPrepareAuthoringResult>;
  deleteData?(pluginId: string): Promise<void>;
  reportError?(error: unknown): void;
}>;
export type RegisterUnifiedPluginInput = Readonly<{
  manifest: UnifiedPluginManifest | unknown; packageDirectory: string; sourceDirectory?: string;
  assertCurrent?(): void;
  projectId?: string; chatIds?: string[]; enabled?: boolean; trust?: true; replace?: boolean; hostAdapter?: true;
  /** Only main may grant essential status to a verified official registration; manifests cannot grant it. */
  trustedEssential?: true;
}>;
export type ActivePluginRuntime = {
  runtime: PreparedPluginRuntime; context: PluginServiceContext; controller: AbortController;
};
export type PluginActivationIdentity = Readonly<{ revisionId: string; activationId: string }>;
export type PluginRevocationScope = PluginActivationIdentity | Readonly<{ all: true }>;
