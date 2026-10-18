/**
 * [INPUT]: Uses canonical built-in Provider identity, Codex runtime discovery, main-owned turn authorization, MCP lease/configuration and verified Git roots.
 * [OUTPUT]: Exports nativeCodexTurnPlan and NativeSpawnConfig.
 * [POS]: Main-only native startup authority; bridge receives a sealed process and requests frozen config once.
 */
import { BUILTIN_PROVIDER_IDS } from "@bottega/contracts/model/provider-capabilities";
import type { CodexTurnOptions } from "../../../../../../shared/ipc/agent/codex-ipc";
import { realpath } from "node:fs/promises";
import type { AgentProcessLaunch, BackendTurnOptions } from "../../../../backends/contracts/types";
import { nativeCodexLaunch } from "./spawn";
import { nativePolicy, type NativeTurnConfig } from "./parameters";
import { linkedWorktreeWriteRoots } from "./git-roots";
import { nativeBackgrounds } from "../background/registry";
import { assertUniqueMcpBackendAliases } from "../../../../../../shared/ipc/settings/mcp-servers-ipc";

export type NativeSpawnConfig = { protocol: "codex-app-server"; launch: AgentProcessLaunch; nativeConfig: NativeTurnConfig };

export async function nativeCodexTurnPlan(options: BackendTurnOptions): Promise<NativeSpawnConfig> {
  assertUniqueMcpBackendAliases(options.thirdPartyMcpPlan?.entries ?? []);
  if (options.filesystemAccess?.mode === "read-only" || options.filesystemAccess?.network === "off" || options.skillIsolation?.deniedRoots.length) {
    throw new Error("Codex bb-native-v1 chat does not enforce this role's read-only, network-off or Skill disk-isolation requirement");
  }
  const turn = options.payload.turnOptions as CodexTurnOptions;
  if (turn.backend !== BUILTIN_PROVIDER_IDS.codex) throw new Error("Native Codex launch received another Provider");
  const roots = [...await linkedWorktreeWriteRoots(options.workspace), ...(options.artifactDirectory ? [await realpath(options.artifactDirectory)] : [])];
  const policy = nativePolicy(turn.permissionMode, roots);
  const servers: Record<string, unknown> = Object.fromEntries((options.thirdPartyMcpPlan?.entries ?? []).map(server => [server.backendAlias,
    server.transport === "stdio" ? { command: server.command, args: [...server.args], env: { ...server.env }, ...(server.cwd ? { cwd: server.cwd } : {}) }
      : { url: server.url, http_headers: { ...server.headers } }]));
  if (options.builtinMcp) {
    const server = options.builtinMcp.server;
    servers[server.name] = { command: server.command, args: [...server.args], env: { ...server.env }, tool_timeout_sec: 600 };
  }
  const settings = options.backendSessionConfig?.providerSettings;
  const memoryOff = options.disableProviderMemory || settings?.memory === false;
  const subagentsOff = settings?.["native-subagents"] === false;
  const config = {
    "sandbox_workspace_write.writable_roots": roots,
    "sandbox_workspace_write.network_access": true,
    "sandbox_workspace_write.exclude_tmpdir_env_var": false,
    "sandbox_workspace_write.exclude_slash_tmp": false,
    ...(memoryOff ? { "features.memories": false, "memories.generate_memories": false, "memories.use_memories": false } : {}),
    ...(subagentsOff ? { "features.multi_agent": false, "agents.max_concurrent_threads_per_session": 1 } : {}),
    mcp_servers: servers,
  };
  if (Buffer.byteLength(JSON.stringify(config)) > 96 * 1024) throw new Error("Native Codex configuration exceeds 96 KiB");
  const effort = turn.reasoningEffort as NonNullable<NativeTurnConfig["turn"]["effort"]>;
  const nativeConfig: NativeTurnConfig = {
    contractId: "bb-native-v1",
    ...(options.payload.session && nativeBackgrounds.continuation(options.payload.scope.conversationId,
      options.chatIncarnationId ?? "provider-bridge", options.payload.session.id) ? {
        continuation: nativeBackgrounds.continuation(options.payload.scope.conversationId,
          options.chatIncarnationId ?? "provider-bridge", options.payload.session.id)!,
      } : {}),
    thread: { cwd: options.workspace, model: turn.model, allowProviderModelFallback: false, serviceTier: turn.serviceTier === "default" ? null : turn.serviceTier,
      sandbox: policy.sandbox, approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer,
      config: config as NativeTurnConfig["thread"]["config"] },
    turn: { cwd: options.workspace, model: turn.model, effort, serviceTier: turn.serviceTier === "default" ? null : turn.serviceTier,
      approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer, sandboxPolicy: policy.sandboxPolicy,
      ...(options.payload.planMode ? { collaborationMode: { mode: "plan", settings: { model: turn.model, reasoning_effort: effort, developer_instructions: null } } } : {}) },
  };
  return { protocol: "codex-app-server", launch: nativeCodexLaunch(options.runtime, options.workspace, options.processEnv), nativeConfig };
}
