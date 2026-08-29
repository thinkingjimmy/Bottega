/**
 * [INPUT]: Depends on Agent backend identity, neutral Product resource scope, Project override intent, and Extension MCP health subject
 * [OUTPUT]: Provides exact-scope masked manual MCP snapshots, scope-fenced mutations/events, no-collision aliases, and main-only frozen third-party plan types
 * [POS]: Shared MCP boundary; renderer sees only global or exact-Project manual servers while package Extension MCP and secret values remain absent
 */

import type { AgentBackendId } from "./agent-ipc";
import type { McpComponentHealthSubject } from "./extensions-ipc";
import type { ToolOverride } from "./project-tools-ipc";
import type {
  EffectiveResourceState,
  ProductResourceScope,
  ResourceBackendSupportView,
  ScopedResourceVersion,
  TurnProjectContext,
} from "./resource-scope";

export const MCP_SERVERS_BRIDGE_UNAVAILABLE =
  "MCP_SERVERS_BRIDGE_UNAVAILABLE";

export const MCP_SERVERS_CHANNEL = {
  list: "mcp-servers:list",
  save: "mcp-servers:save",
  remove: "mcp-servers:remove",
  changed: "mcp-servers:changed",
} as const;

export type McpSecretView = Readonly<{
  name: string;
  hasValue: true;
  maskedValue: "••••••••";
}>;

export type ManualMcpEligibility =
  | "eligible"
  | "remote-policy-unsupported"
  | "authenticated-remote-unsupported"
  | "query-remote-unsupported";

export type McpServerHealthView = Readonly<{
  state: "unobserved" | "healthy" | "degraded" | "quarantined";
  revision: number;
  detail: string;
}>;

export type McpServerEffectiveSource =
  | "global-default"
  | "project-override"
  | "project-owned";

type McpServerViewBase = Readonly<{
  serverId: `manual:${string}`;
  source: "manual";
  owner: ProductResourceScope;
  displayName: string;
  /** Persisted owner value before an exact Project override is applied. */
  configuredEnabled: boolean;
  /** User intent in the queried scope; hard backend limits are separate. */
  enabled: boolean;
  override: ToolOverride | null;
  effectiveState: EffectiveResourceState;
  effectiveSource: McpServerEffectiveSource;
  backendSupport: readonly ResourceBackendSupportView[];
  eligibility: ManualMcpEligibility;
  configDigest: string;
  health: McpServerHealthView;
}>;

export type ManualMcpServerView =
  | (McpServerViewBase &
      Readonly<{
        transport: "stdio";
        command: string;
        args: readonly string[];
        env: readonly McpSecretView[];
      }>)
  | (McpServerViewBase &
      Readonly<{
        transport: "streamable-http" | "sse";
        url: string;
        headers: readonly McpSecretView[];
      }>);

/* 包 Extension MCP 不在这份契约里，也不是"暂时没投影"：renderer 面只认
   manual server，让"零暴露"由类型系统承担，而不是由某个投影函数的纪律。 */
export type McpServersSnapshot = Readonly<{
  queryScope: ProductResourceScope;
  storeRevision: number;
  globalScopeRevision: number;
  projectScopeRevision: number | null;
  projectLifecycleRevision: number | null;
  servers: readonly ManualMcpServerView[];
}>;

export type McpSecretEdit =
  | Readonly<{ name: string; action: "keep" }>
  | Readonly<{ name: string; action: "clear" }>
  | Readonly<{ name: string; action: "replace"; value: string }>;

export type ManualMcpServerDraft = Readonly<{
  displayName: string;
  enabled: boolean;
  config:
    | Readonly<{
        transport: "stdio";
        command: string;
        args: readonly string[];
        env: readonly McpSecretEdit[];
      }>
    | Readonly<{
        transport: "streamable-http" | "sse";
        url: string;
        headers: readonly McpSecretEdit[];
      }>;
}>;

type ManualMcpMutationFence =
  | Readonly<{
      scope: Readonly<{ kind: "global" }>;
      expectedScopeRevision: number;
      expectedProjectLifecycleRevision: null;
    }>
  | Readonly<{
      scope: Readonly<{ kind: "project"; projectId: string }>;
      expectedScopeRevision: number;
      expectedProjectLifecycleRevision: number;
    }>;

export type SaveManualMcpServerInput = ManualMcpMutationFence & Readonly<{
  serverId?: `manual:${string}`;
  draft: ManualMcpServerDraft;
}>;

export type RemoveManualMcpServerInput = ManualMcpMutationFence & Readonly<{
  serverId: `manual:${string}`;
}>;

export type McpServersQuery = Readonly<{
  scope: ProductResourceScope;
}>;

export type McpServersChangedEvent = Readonly<{
  version: ScopedResourceVersion;
  storeRevision: number;
}>;

export type McpServersBridgeApi = Readonly<{
  list(input: McpServersQuery): Promise<McpServersSnapshot>;
  save(input: SaveManualMcpServerInput): Promise<McpServersSnapshot>;
  remove(input: RemoveManualMcpServerInput): Promise<McpServersSnapshot>;
  onChanged(listener: (event: McpServersChangedEvent) => void): () => void;
}>;

export type ThirdPartyMcpPlanSource =
  | Readonly<{ kind: "manual"; scope: ProductResourceScope }>
  | Readonly<{ kind: "package-global"; generationRef: string }>
  | Readonly<{
      kind: "app-requirement";
      appId: string;
      generationRef: string;
    }>;

type ThirdPartyMcpPlanEntryBase = Readonly<{
  identity: string;
  backendAlias: string;
  displayName: string;
  source: ThirdPartyMcpPlanSource;
  configDigest: string;
  healthSubject: McpComponentHealthSubject;
}>;

export type ThirdPartyMcpPlanEntry = ThirdPartyMcpPlanEntryBase & (
  | Readonly<{
      transport: "stdio";
      command: string;
      args: readonly string[];
      env: Readonly<Record<string, string>>;
      cwd?: string;
    }>
  | Readonly<{
      transport: "streamable-http" | "sse";
      url: string;
      headers: Readonly<Record<string, string>>;
    }>
);

/** main 内存态；绝不作为 IPC 返回值。 */
export type ThirdPartyMcpPlan = Readonly<{
  planInstanceId: string;
  backendId: AgentBackendId;
  projectContext: TurnProjectContext;
  entries: readonly ThirdPartyMcpPlanEntry[];
  planDigest: string;
}>;

/**
 * UTF-8 字节只保留 ASCII 字母数字，其余一律编码成 `_xx`。`_` 自身也会编码，
 * 因而编码串可逆且无歧义；`a.b` 与 `a_b` 不再被清洗成同一个名字。
 */
export function mcpBackendAlias(identity: string) {
  const encoded = [...new TextEncoder().encode(identity)]
    .map((byte) =>
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a)
        ? String.fromCharCode(byte)
        : `_${byte.toString(16).padStart(2, "0")}`
    )
    .join("");
  return `mcp_${encoded}`;
}

/** translator 边界再验一次，拒绝任何绕过 planner 构造的静默覆盖。 */
export function assertUniqueMcpBackendAliases(
  entries: readonly Pick<ThirdPartyMcpPlanEntry, "identity" | "backendAlias">[]
) {
  const aliases = new Map<string, string>();
  for (const entry of entries) {
    const owner = aliases.get(entry.backendAlias);
    if (owner !== undefined) {
      throw new Error(
        `MCP backend alias 冲突：${owner} 与 ${entry.identity} -> ${entry.backendAlias}`
      );
    }
    aliases.set(entry.backendAlias, entry.identity);
  }
}
