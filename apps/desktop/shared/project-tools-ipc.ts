/**
 * [INPUT]: Depends on neutral resource scope/version and renderer-safe backend support facts
 * [OUTPUT]: Provides exact-Project Tool Policy snapshots, effective built-in rows, CAS mutations, changed events, and the narrow preload bridge
 * [POS]: Shared wire authority for Project-owned tool overrides; it never lists every Project policy or carries MCP secrets
 */

import type {
  EffectiveResourceState,
  ResourceBackendSupportView,
  ScopedResourceVersion,
} from "./resource-scope";

export const PROJECT_TOOLS_BRIDGE_UNAVAILABLE =
  "PROJECT_TOOLS_BRIDGE_UNAVAILABLE";

export const PROJECT_TOOLS_ERROR_CODES = [
  "project-not-found",
  "project-lifecycle-conflict",
  "scope-revision-conflict",
  "owner-mismatch",
  "store-corrupt",
] as const;

export type ProjectToolsErrorCode =
  (typeof PROJECT_TOOLS_ERROR_CODES)[number];

export type ToolOverride = "enabled" | "disabled";

export type ProjectToolPolicyPayload = Readonly<{
  builtinOverrides: Readonly<Record<string, ToolOverride>>;
  globalMcpOverrides: Readonly<
    Record<`manual:${string}`, ToolOverride>
  >;
}>;

export type BuiltinToolEffectiveSource =
  | "global-default"
  | "project-override";

export type ProjectBuiltinToolView = Readonly<{
  toolId: string;
  globalEnabled: boolean;
  override: ToolOverride | null;
  intentEnabled: boolean;
  effectiveState: EffectiveResourceState;
  source: BuiltinToolEffectiveSource;
  backendSupport: readonly ResourceBackendSupportView[];
}>;

export type ProjectToolPolicySnapshot = Readonly<{
  version: ScopedResourceVersion &
    Readonly<{
      scope: Readonly<{ kind: "project"; projectId: string }>;
      projectLifecycleRevision: number;
    }>;
  storeRevision: number;
  policy: ProjectToolPolicyPayload;
  builtinTools: readonly ProjectBuiltinToolView[];
}>;

export type ProjectToolsChangedEvent = Readonly<{
  projectId: string;
  projectLifecycleRevision: number;
  projectPolicyRevision: number;
  storeRevision: number;
}>;

export type ProjectToolPolicyQuery = Readonly<{
  projectId: string;
}>;

type ProjectToolPolicyMutationFence = Readonly<{
  projectId: string;
  expectedProjectLifecycleRevision: number;
  expectedProjectPolicyRevision: number;
}>;

export type SetProjectBuiltinToolOverrideInput =
  ProjectToolPolicyMutationFence &
    Readonly<{
      toolId: string;
      override: ToolOverride;
    }>;

export type ResetProjectBuiltinToolOverrideInput =
  ProjectToolPolicyMutationFence & Readonly<{ toolId: string }>;

export type SetProjectGlobalMcpOverrideInput =
  ProjectToolPolicyMutationFence &
    Readonly<{
      serverId: `manual:${string}`;
      override: ToolOverride;
    }>;

export type ResetProjectGlobalMcpOverrideInput =
  ProjectToolPolicyMutationFence &
    Readonly<{ serverId: `manual:${string}` }>;

export type ResetProjectToolPolicyInput = ProjectToolPolicyMutationFence;

export const PROJECT_TOOLS_CHANNEL = {
  get: "project-tools:get",
  setBuiltinOverride: "project-tools:builtin:set-override",
  resetBuiltinOverride: "project-tools:builtin:reset-override",
  setGlobalMcpOverride: "project-tools:mcp:set-override",
  resetGlobalMcpOverride: "project-tools:mcp:reset-override",
  resetAll: "project-tools:reset-all",
  changed: "project-tools:changed",
} as const;

export type ProjectToolsBridgeApi = Readonly<{
  get(input: ProjectToolPolicyQuery): Promise<ProjectToolPolicySnapshot>;
  setBuiltinOverride(
    input: SetProjectBuiltinToolOverrideInput
  ): Promise<ProjectToolPolicySnapshot>;
  resetBuiltinOverride(
    input: ResetProjectBuiltinToolOverrideInput
  ): Promise<ProjectToolPolicySnapshot>;
  setGlobalMcpOverride(
    input: SetProjectGlobalMcpOverrideInput
  ): Promise<ProjectToolPolicySnapshot>;
  resetGlobalMcpOverride(
    input: ResetProjectGlobalMcpOverrideInput
  ): Promise<ProjectToolPolicySnapshot>;
  resetAll(
    input: ResetProjectToolPolicyInput
  ): Promise<ProjectToolPolicySnapshot>;
  onChanged(
    listener: (event: ProjectToolsChangedEvent) => void
  ): () => void;
}>;
