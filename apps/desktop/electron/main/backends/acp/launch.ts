/**
 * [INPUT]: Depends on ACP McpServer, BackendTurnOptions, the session config values, the startup budget type, and the Seatbelt fence table
 * [OUTPUT]: Provides AcpSpawnConfig (with each Provider's optional session-absence matcher and prompt replay), turnLaunch (the fenced launch main seals on a bridged turn's execution ref, its env carrying the host-sandbox marker exactly when it wrapped; a Chat plan turn always gets the read-only fence; a network-off fence denies the whole network) and acpMcpServers (the servers a session is created with); built-ins are fenced here and package Providers pass this plan through HostPackageRuntime's shared fence before sealing
 * Workflow Skill isolation contributes explicit read denials to the host fence.
 * [POS]: Main's half of an ACP turn's launch (TASK-11 flip, step 5): main builds and seals it, the bridge only runs it, so it lives outside the bridge's turn machinery
 */

import { builtinAgent } from "../../../../shared/chat-agent/options";
import type { ContentBlock, McpServer } from "@agentclientprotocol/sdk";
import type { BackendFailure, BackendTurnOptions, FailureHints } from "../types";
import type { AcpStartupBudget } from "./startup/budget";
import type { AcpTurnConfigValues } from "../../providers/bridge/acp/session/config";
import { withHostSandboxMarker, wrapInteractiveWithSeatbelt } from "../sandbox/seatbelt";
import { seatbeltOwned } from "../sandbox/fences";

export type AcpSpawnConfig = AcpTurnConfigValues & {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  validateSessionId: (id: string) => boolean;
  resumeWithoutReplay?: boolean;
  /** The Provider's report that a resumed session is gone, so the turn starts a new one. Absent: never read a failure as absence
      (an unknown storage fault must not become a silent new session). */
  sessionMissing?: (sessionId: string, cause: unknown) => boolean;
  /** The text the Provider's adapter persists for a prompt, which a native session's replay proof matches (bridge only: the
      bridge's turn-values table adds it). Absent: text blocks only. */
  promptReplay?: (blocks: readonly ContentBlock[]) => string[];
  suppressAlwaysApprovalOptions?: boolean;
  classifyFailure?(cause: unknown, hints?: FailureHints): BackendFailure;
  reviewResidualApprovals?: boolean;
  builtinMcpTransport?: "acp" | "backend-config";
  thirdPartyMcpTransport?: "acp" | "backend-config";
  sessionMeta?: (options: BackendTurnOptions) => Record<string, unknown>;
  /** The session's MCP servers when they are not in these options (a bridged turn's are blanked): asked for at each session
      creation, never kept (TASK-11 D2). Absent, `acpMcpServers` builds them from the options. */
  resolveMcpServers?: () => Promise<McpServer[]>;
  /** 分步预算只声明真实后端与默认值的差异。 */
  startupBudgetMs?: AcpStartupBudget;
};

/**
 * The exact process a turn runs: the backend launch wrapped in the fence the declaration table assigns to it. One
 * function so the in-process turn and a bridged turn (whose launch main seals before the bridge ever sees it) agree.
 */
export function turnLaunch(options: BackendTurnOptions, config: AcpSpawnConfig) {
  const backend = options.payload.turnOptions.backend;
  /* A Chat plan turn is read-only whatever its permission mode: full access in plan mode would otherwise be a write-enabled fence
     (asking nobody, since full access never asks) around a mode whose whole promise is that it proposes and does not apply. */
  const plan = Boolean(options.payload.planMode);
  // 谁进 seatbelt 由围栏声明表回答，不在这里维护一份平行名单。
  /* Package Providers pass the returned plan through HostPackageRuntime before issuing an execution reference. */
  const fencedBackend = builtinAgent(backend);
  const fenced = Boolean(options.filesystemAccess && fencedBackend && seatbeltOwned(fencedBackend));
  const mode = options.filesystemAccess ? options.filesystemAccess.mode ?? (plan ? "read-only" : undefined) ?? "workspace-write" : null;
  const wrapped =
    fenced && options.filesystemAccess && fencedBackend
      ? wrapInteractiveWithSeatbelt({
          command: config.command,
          args: config.args,
          env: config.env,
          backend: fencedBackend,
          permissionMode: options.payload.turnOptions.permissionMode,
          workspace: options.filesystemAccess.workspace,
          filesystem: options.filesystemAccess.mode ?? (plan ? "read-only" : undefined),
          plan,
          stateWriteRoots: options.artifactDirectory ? [options.artifactDirectory] : [],
          readOnlyRoots: options.filesystemAccess.readOnlyRoots,
          deniedReadRoots: options.skillIsolation?.deniedRoots,
          controlRoot: options.filesystemAccess.controlRoot,
          builtinMcpServer: options.builtinMcp?.server,
          thirdPartyMcpServers: options.thirdPartyMcpPlan?.entries.flatMap(
            (entry) => entry.transport === "stdio" ? [entry] : []
          ),
          agentRuntime: options.runtime.executable,
          /* Never admitted for these Providers (their CLI talks to its model from inside the fence); if asked anyway, fail closed. */
          network: options.filesystemAccess.network !== "off",
        })
      : { command: config.command, args: config.args };
  /* Last, so no package or user value can claim a fence this launch does not have. */
  return { command: wrapped.command, args: wrapped.args, cwd: options.workspace,
    env: withHostSandboxMarker(config.env, fenced ? mode : null, options.payload.turnOptions.permissionMode === "full-access") };
}

/* ============================================================
 * stdio 条目恒为 ACP v1 正典形状：**没有 `type` 字段**。SDK 1.3.0 的
 * `McpServerStdio`（`schema/types.gen.d.ts:4805`）只有 name/command/args/env，
 * 判别式留给 http/sse/acp 三个变体，stdio 靠「没有 type」被识别。
 *
 * 别被 kimi 0.38.0 骗去加一格方言（2026-08-27 真机三臂已证死路）：它的
 * `acpMcpServersToConfigRecord` 对无 `type` 的条目直接 throw
 * 「does not declare a runtime identity」，而它自己的 schema 又会把
 * `type:"stdio"` 当未知键剥掉 ⇒ 补也补不进去；且该函数只有 http/sse 两条
 * 出口，**根本没有 stdio 分支**，它的 `mcpCapabilities` 也只声明
 * `{http,sse}`。⇒ kimi 侧的解法不在这里，见 providers/kimi/README.md。
 * ============================================================ */
export function acpMcpServers(
  options: BackendTurnOptions,
  config: AcpSpawnConfig
): McpServer[] {
  const thirdParty =
    config.thirdPartyMcpTransport === "backend-config"
      ? []
      : (options.thirdPartyMcpPlan?.entries ?? []).map((server): McpServer =>
          server.transport === "stdio"
            ? {
                name: server.backendAlias,
                command: server.command,
                args: [...server.args],
                env: Object.entries(server.env).map(([name, value]) => ({
                  name,
                  value,
                })),
              }
            : {
                name: server.backendAlias,
                type: server.transport === "streamable-http" ? "http" : "sse",
                url: server.url,
                headers: Object.entries(server.headers).map(([name, value]) => ({
                  name,
                  value,
                })),
              });
  if (config.builtinMcpTransport === "backend-config") return thirdParty;
  const builtin = options.builtinMcp?.server;
  if (!builtin) return thirdParty;
  return [
    ...thirdParty,
    {
      name: builtin.name,
      command: builtin.command,
      args: builtin.args,
      env: Object.entries(builtin.env).map(([name, value]) => ({
        name,
        value,
      })),
    },
  ];
}
