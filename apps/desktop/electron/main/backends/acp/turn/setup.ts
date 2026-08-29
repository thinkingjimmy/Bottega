/**
 * [INPUT]: Depends on ACP ContentBlock/McpServer, Node spawn, BackendTurnOptions, session config and steering input and conversion
 * [OUTPUT]: Provides AcpSpawnConfig, missing process host, resume missing, determines, prompt block and MCP server installed
 * [POS]: The backends/acp/turn startup configuration and the pure projection layer; AcpTurn only retains the lifecycle of the protocol state machine and one turn
 */

import type { ContentBlock, McpServer } from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { asError } from "../../../errors";
import type {
  AgentProcessHost,
  AgentProcessLauncher,
  BackendFailure,
  BackendTurnOptions,
  FailureHints,
} from "../../types";
import type { AcpStartupBudget } from "../startup/budget";
import type { AcpTurnConfigValues } from "../session/config";
import { resolvedInputBlocks } from "./acp-steering";

export type AcpSpawnConfig = AcpTurnConfigValues & {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  validateSessionId: (id: string) => boolean;
  resumeWithoutReplay?: boolean;
  /** `never` 明确禁止把未知存储故障降级成“会话不存在”。 */
  resumeMissingPolicy?: "never" | ((cause: unknown) => boolean);
  suppressAlwaysApprovalOptions?: boolean;
  classifyFailure?(cause: unknown, hints?: FailureHints): BackendFailure;
  reviewResidualApprovals?: boolean;
  builtinMcpTransport?: "acp" | "backend-config";
  thirdPartyMcpTransport?: "acp" | "backend-config";
  sessionMeta?: (options: BackendTurnOptions) => Record<string, unknown>;
  /** 分步预算只声明真实后端与默认值的差异。 */
  startupBudgetMs?: AcpStartupBudget;
};

/** 无 custody 时的缺省宿主，也是测试注入假 child 的唯一入口。 */
export function processHostOf(
  launch: AgentProcessLauncher = (request) =>
    spawn(request.command, [...request.args], {
      cwd: request.cwd,
      detached: true,
      env: request.env,
    })
): AgentProcessHost {
  return { launch, delivered: Promise.resolve() };
}

export function isResumeMissing(
  cause: unknown,
  policy: AcpSpawnConfig["resumeMissingPolicy"]
) {
  if (policy === "never") return false;
  if (policy) return policy(cause);
  return /(?:session|conversation).*(?:not found|unknown|does not exist|expired|invalid)/i.test(
    asError(cause).message
  );
}

export function promptBlocks(options: BackendTurnOptions): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (options.productContext) {
    blocks.push({ type: "text", text: options.productContext });
  }
  if (options.sensitiveContribution) {
    const validation = options.sensitiveContribution.consume();
    options.onPromptContributionValidation?.(validation);
    if (validation.kind === "allowed") {
      blocks.push({
        type: "text",
        text: options.sensitiveContribution.text,
      });
    }
  }
  blocks.push(...resolvedInputBlocks(options.input.input));
  return blocks;
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
 * `{http,sse}`。⇒ kimi 侧的解法不在这里，见 backends/kimi/README.md。
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
