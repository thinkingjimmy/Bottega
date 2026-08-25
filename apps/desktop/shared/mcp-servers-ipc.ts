/**
 * [INPUT]: Depends on Agent backend identity and Extension MCP health subject; Configure writing to accept only explicit secret edit, not renderer, and return old text
 * [OUTPUT]: Provides a manual MCP server with masked renderer DTO, three IPC contracts, no-collision backend alias, coding/unique claims and main-only frozen third-party plan types
 * [POS]: The MCP configuring borders of shared; The disk drives and backend are not allowed to pass through the renderer bridge at the moment
 */

import type { AgentBackendId } from "./agent-ipc";
import type { McpComponentHealthSubject } from "./extensions-ipc";

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

type McpServerViewBase = Readonly<{
  serverId: `manual:${string}`;
  source: "manual";
  displayName: string;
  enabled: boolean;
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

export type PackageMcpServerView = Readonly<{
  serverId: `pkg:${string}`;
  source: "package";
  displayName: string;
  enabled: boolean;
  eligibility: "transport-unsupported" | "package-disabled" | "component-disabled";
  configDigest: string;
  health: McpServerHealthView;
  transport: "stdio" | "streamable-http" | "sse";
  target: "sealed mcp.json";
}>;

export type McpServerView = ManualMcpServerView | PackageMcpServerView;

export type McpServersSnapshot = Readonly<{
  revision: number;
  inventoryRevision?: string;
  servers: readonly McpServerView[];
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

export type SaveManualMcpServerInput = Readonly<{
  expectedRevision: number;
  serverId?: `manual:${string}`;
  draft: ManualMcpServerDraft;
}>;

export type RemoveManualMcpServerInput = Readonly<{
  expectedRevision: number;
  serverId: `manual:${string}`;
}>;

export type McpServersBridgeApi = Readonly<{
  list(): Promise<McpServersSnapshot>;
  save(input: SaveManualMcpServerInput): Promise<McpServersSnapshot>;
  remove(input: RemoveManualMcpServerInput): Promise<McpServersSnapshot>;
  onChanged(listener: (snapshot: McpServersSnapshot) => void): () => void;
}>;

export type ThirdPartyMcpPlanSource =
  | Readonly<{ kind: "manual" }>
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
