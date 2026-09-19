/**
 * [INPUT]: Depends on the connection launch planner, the connection runtime, the built-in MCP result budget and the chat incarnation lookup
 * [OUTPUT]: Provides chatConnectionPlan (the one plan builder claim and warm share), chatConnectionClaimPort (the bridge option the window hands over) and resolveTurnConnection (the bridge's claim-or-cold-path decision)
 * [POS]: The only place a chat turn is translated into a connection claim; main-window stays a composition root and agent-bridge stays a lifecycle owner
 */

import type {
  AgentSendPayload,
  AgentTurnOptions,
} from "../../../shared/agent-ipc";
import type { BuiltinToolName } from "../../../shared/builtin-tools";
import type { ThirdPartyMcpPlan } from "../../../shared/mcp-servers-ipc";
import { backendById } from "../backends";
import type { ResolvedRuntime } from "../backends/types";
import { initiatorResultByteBudget } from "../tools/lease";
import type {
  AgentBridgeOptions,
  AgentContext,
  BridgeEntry,
} from "./bridge-types";
import type { AgentConnectionRuntime } from "./connection-runtime";
import { connectionLaunchPlan } from "./launch-plan";

type ClaimInput = {
  payload: AgentSendPayload;
  context: AgentContext;
  generation: number;
  runtime: ResolvedRuntime;
  runtimeGeneration: number;
  artifactDirectory?: string;
  thirdPartyMcpPlan?: ThirdPartyMcpPlan;
};

/** 认领与预热共用的输入：两条路只要在这里对齐，键就必然对齐。 */
export type ConnectionPlanRequest = {
  conversationId: string;
  turnOptions: AgentTurnOptions;
  context: AgentContext;
  runtime: ResolvedRuntime;
  runtimeGeneration: number;
  allowedTools: readonly BuiltinToolName[];
  artifactDirectory?: string;
  /* 计划本体，不是摘要：摘要在 `connectionLaunchPlan` 里从它推导，
     常驻进程带的 server 与键里的摘要因此不可能各说各话。 */
  thirdPartyMcpPlan?: ThirdPartyMcpPlan;
};

/**
 * 一个 chat turn 的连接计划。它与 bridge 的 createTurn 的 spawn 相关格子同源：
 * 两边只要有一格漂移，复用的就是围栏不同的进程——所以清单只在
 * `connectionLaunchPlan` 里维护一份，而认领与预热都只经过这一个函数。
 */
export function chatConnectionPlan(
  request: ConnectionPlanRequest,
  incarnationOf: (conversationId: string) => string | undefined
) {
  const incarnationId = incarnationOf(request.conversationId);
  if (!incarnationId) return undefined;
  const backend = request.turnOptions.backend;
  const resultByteBudget = initiatorResultByteBudget(backend);
  const allowedTools = request.allowedTools;
  return connectionLaunchPlan({
    descriptor: backendById(backend),
    backend,
    turnOptions: request.turnOptions,
    workspace: request.context.workspace,
    permissionMode: request.turnOptions.permissionMode,
    runtime: request.runtime,
    runtimeGeneration: request.runtimeGeneration,
    ...(request.context.appId ? { appId: request.context.appId } : {}),
    ...(request.context.filesystemAccess
      ? { filesystemAccess: { ...request.context.filesystemAccess } }
      : {}),
    ...(request.artifactDirectory
      ? { artifactDirectory: request.artifactDirectory }
      : {}),
    ...(request.thirdPartyMcpPlan
      ? { thirdPartyMcpPlan: request.thirdPartyMcpPlan }
      : {}),
    ...(allowedTools.length
      ? {
          builtinAdvertisement: { allowedTools, resultByteBudget },
          builtin: {
            chatId: request.conversationId,
            incarnationId,
            allowedTools: [...allowedTools],
            resultByteBudget,
          },
        }
      : {}),
  });
}

const claimRequest = (input: ClaimInput): ConnectionPlanRequest => ({
  conversationId: input.payload.scope.conversationId,
  turnOptions: input.payload.turnOptions,
  context: input.context,
  runtime: input.runtime,
  runtimeGeneration: input.runtimeGeneration,
  allowedTools: input.context.finalTurnProjection?.allowedTools ?? [],
  ...(input.artifactDirectory
    ? { artifactDirectory: input.artifactDirectory }
    : {}),
  ...(input.thirdPartyMcpPlan
    ? { thirdPartyMcpPlan: input.thirdPartyMcpPlan }
    : {}),
});

export function chatConnectionClaimPort(ports: {
  connections: AgentConnectionRuntime;
  incarnationOf(conversationId: string): string | undefined;
}): Pick<AgentBridgeOptions, "claimAgentConnection"> {
  return {
    claimAgentConnection: async (input) => {
      const plan = chatConnectionPlan(claimRequest(input), ports.incarnationOf);
      if (!plan) return undefined;
      return ports.connections.claim(plan, {
        requestId: input.payload.requestId,
        generation: input.generation,
        ...(input.context.skillsCustodyId
          ? { skillsCustodyId: input.context.skillsCustodyId }
          : {}),
        ...(input.payload.handoff?.binding
          ? { historyBinding: input.payload.handoff.binding }
          : {}),
      });
    },
  };
}

/**
 * 认领必须排在内置 lease 之前：借来的连接自带一份连接级 lease，而 token 与
 * 广告面在子进程启动时就交给 CLI 了，本轮补签一份没人认。
 */
export async function resolveTurnConnection(
  options: AgentBridgeOptions,
  entry: BridgeEntry,
  input: Omit<ClaimInput, "thirdPartyMcpPlan" | "artifactDirectory"> & {
    artifactDirectory?: string;
  }
) {
  const claim = {
    ...input,
    ...(entry.thirdPartyMcpPlan
      ? { thirdPartyMcpPlan: entry.thirdPartyMcpPlan }
      : {}),
  };
  /* trace 是逐进程的：tee 在连接建立时装或不装，装不上就补不了。借一条
     没装 tee 的连接会让这一轮的 wire 记录整段缺席，而缺席的记录比没有
     记录更坏——所以开了 trace 的 turn 一律走冷路径。 */
  entry.connection = entry.trace
    ? undefined
    : await options.claimAgentConnection?.(claim);
  entry.builtinMcp =
    entry.connection?.builtinMcp?.turnView() ??
    options.issueBuiltinMcp?.(
      input.payload,
      input.generation,
      entry.origin,
      input.context
    );
  return entry.builtinMcp;
}
