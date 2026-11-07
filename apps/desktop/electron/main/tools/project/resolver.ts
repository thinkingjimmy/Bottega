/**
 * [INPUT]: Depends on canonical ProjectStore, ProjectToolPolicyStore, scoped ManualMcpServersStore, builtin registry ids, shared support/effective projection, and global disabled-tool defaults
 * [OUTPUT]: Provides freezeProjectToolPreference, projectBuiltinInventory, ResolvedProjectToolsSnapshot, and ProjectToolsResolver for durable preparation
 * [POS]: Pure merge boundary between live main-owned stores and the preparation receipt; runtime consumes one frozen snapshot instead of rereading stores
 */

import {
  registeredToolSpecs,
  type PluginToolName,
} from "../../../../shared/plugin-tools";
import type { ProviderId } from "@bottega/contracts/model/provider";
import type {
  ProjectBuiltinToolView,
  ProjectToolPolicyPayload,
} from "../../../../shared/ipc/workspace/project-tools-ipc";
import type { ResourceBackendSupportView } from "../../../../shared/product/resource-scope";
import { projectEffectiveState } from "../../../../shared/tools/tool-support";
import type {
  ProductResourceScope,
  ScopedResourceVersion,
  TurnProjectContext,
} from "../../../../shared/product/resource-scope";
import type { ProjectStore } from "../../projects/store/project-store";
import { modeToolSelection } from "../../sections/coordinator/turns/mode-admission";
import { projectBuiltinTools } from "../issuance";
import type {
  ManualMcpServersStore,
  ResolvedManualMcpServer,
} from "../mcp/store";
import type { ProjectToolPolicyStore } from "./store";

export type GlobalBuiltinToolDefaults = Readonly<{
  revision: number;
  disabledTools: readonly PluginToolName[];
}>;

export type FrozenManualMcpCandidate = Readonly<{
  serverId: `manual:${string}`;
  displayName: string;
  scope: ProductResourceScope;
  enabled: boolean;
  eligibility: ResolvedManualMcpServer["eligibility"];
  configDigest: `sha256:${string}`;
  config: ResolvedManualMcpServer["config"];
}>;

export type ResolvedProjectToolsSnapshot = Readonly<{
  projectContext: TurnProjectContext;
  resourceVersion: ScopedResourceVersion;
  workspace: string | null;
  policyRevisions: Readonly<{ global: number; project: number | null }>;
  mcpScopeRevisions: Readonly<{ global: number; project: number | null }>;
  builtinIntent: Readonly<{ disabledTools: readonly PluginToolName[] }>;
  allowedTools: readonly PluginToolName[];
  mcpCandidates: readonly FrozenManualMcpCandidate[];
}>;

export function freezeProjectToolPreference(input: Readonly<{
  builtinTools: readonly PluginToolName[];
  globalDisabledTools: readonly PluginToolName[];
  policy: ProjectToolPolicyPayload | null;
}>) {
  const globalDisabled = new Set(input.globalDisabledTools);
  const disabledTools = input.builtinTools.filter((toolId) => {
    const override = input.policy?.builtinOverrides[toolId];
    return override ? override === "disabled" : globalDisabled.has(toolId);
  });
  const disabled = new Set(disabledTools);
  return {
    disabledTools,
    allowedTools: input.builtinTools.filter((toolId) => !disabled.has(toolId)),
  };
}

export function projectBuiltinInventory(input: Readonly<{
  globalDisabledTools: readonly string[];
  policy: ProjectToolPolicyPayload;
  backendSupport: (toolId: PluginToolName) => readonly ResourceBackendSupportView[];
}>): readonly ProjectBuiltinToolView[] {
  const globalDisabled = new Set(input.globalDisabledTools);
  return registeredToolSpecs()
    .filter((spec) => !("exactIssued" in spec) || spec.exactIssued !== true)
    .map((spec) => {
      const override = input.policy.builtinOverrides[spec.name] ?? null;
      const globalEnabled = !globalDisabled.has(spec.name);
      const intentEnabled = override
        ? override === "enabled"
        : globalEnabled;
      const backendSupport = input.backendSupport(spec.name);
      return {
        toolId: spec.name,
        globalEnabled,
        override,
        intentEnabled,
        effectiveState: projectEffectiveState(intentEnabled, backendSupport),
        source: override ? "project-override" as const : "global-default" as const,
        backendSupport,
      };
    });
}

function resolveManualMcpPreference(
  servers: readonly ResolvedManualMcpServer[],
  policy: ProjectToolPolicyPayload | null
): readonly FrozenManualMcpCandidate[] {
  return servers.map((server) => {
    const serverId = server.serverId as `manual:${string}`;
    return {
    serverId,
    displayName: server.displayName,
    scope: structuredClone(server.scope),
    enabled: server.scope.kind === "global"
      ? (policy?.globalMcpOverrides[serverId] ??
          (server.enabled ? "enabled" : "disabled")) === "enabled"
      : server.enabled,
    eligibility: server.eligibility,
    configDigest: server.configDigest,
    config: structuredClone(server.config),
  };
  });
}

export class ProjectToolsResolver {
  constructor(
    private readonly projects: ProjectStore,
    private readonly policies: ProjectToolPolicyStore,
    private readonly mcpServers: ManualMcpServersStore,
    private readonly builtinRegistry: readonly PluginToolName[],
    private readonly globalDefaults: () => GlobalBuiltinToolDefaults
  ) {}

  resolve(input: Readonly<{
    projectId: string | null;
    workspace: string;
    backend: ProviderId;
    builtinTools: "none" | "read" | "mutate";
    planMode: boolean;
    mode?: import("@bottega/contracts/plugins/platform").PluginModeSelection;
  }>): ResolvedProjectToolsSnapshot {
    const { projectId } = input;
    const projectContext = this.projects.turnContext(projectId);
    const scope: ProductResourceScope = projectId
      ? { kind: "project", projectId }
      : { kind: "global" };
    const defaults = this.globalDefaults();
    const policySnapshot = projectId ? this.policies.project(projectId) : null;
    const policy = policySnapshot?.policy ?? null;
    const intent = freezeProjectToolPreference({
      builtinTools: this.builtinRegistry,
      globalDisabledTools: defaults.disabledTools,
      policy,
    });
    const project = projectId ? this.projects.get(projectId) : undefined;
    return {
      projectContext,
      resourceVersion: {
        scope,
        projectLifecycleRevision: projectContext.projectLifecycleRevision,
        scopeRevision: policySnapshot?.projectRevision ?? defaults.revision,
      },
      workspace: project
        ? (this.projects.resolveWorkspace(project.workspaceBinding) ?? project.dir) || null
        : null,
      policyRevisions: {
        global: defaults.revision,
        project: policySnapshot?.projectRevision ?? null,
      },
      mcpScopeRevisions: {
        global: this.mcpServers.scopeRevision({ kind: "global" }),
        project: projectId ? this.mcpServers.scopeRevision(scope) : null,
      },
      builtinIntent: { disabledTools: intent.disabledTools },
      allowedTools: projectBuiltinTools({
        ...modeToolSelection({backend:input.backend,mode:input.mode}),
        builtinTools: input.builtinTools,
        backend: input.backend,
        planMode: input.planMode,
        origin: {
          kind: "manual",
          queryText: "",
          userText: "",
          userMessageId: "project-tools-preparation",
        },
        disabledTools: intent.disabledTools,
        useSkill: false,
      }),
      mcpCandidates: resolveManualMcpPreference(this.mcpServers.resolved(scope), policy),
    };
  }
}
