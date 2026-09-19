/**
 * [INPUT]: Depends on the bridge's context chain (resolveContext / finalizeContextForRuntime / resolveThirdPartyMcpPlan), the backend runtime registry, the pure built-in tool projection and the shared connection plan builder
 * [OUTPUT]: Provides warmAgentConnection and agentConnectionWarmSink — the main-side half of the warm intent, which builds the first turn's launch plan without a payload and hands it to the pool
 * [POS]: The warm counterpart of connection-wiring's claim; both end in the same `chatConnectionPlan`, which is what makes the warmed key equal to the first turn's
 */

import type { AgentBackendId, AgentTurnOptions } from "../../../shared/agent-ipc";
import type { WarmIntent } from "../../../shared/agent-connections-ipc";
import { backendRuntimeRegistry } from "../backends";
import { projectBuiltinTools } from "../tools/issuance";
import type { AgentBridgeOptions, TurnOrigin } from "./bridge-types";
import type { ConnectionLaunchPlan } from "./connection-runtime";
import { chatConnectionPlan } from "./connection-wiring";

/* ============================================================
 * 预热存在的前提就是"一条手动消息马上要来"，所以这里声明的是**轮类**，
 * 不是某条消息。两个消费者都只读 `kind`：`projectBuiltinTools` 经
 * `turnKindForOrigin`，`buildManualMcpPlan` 经 `origin?.kind === "manual"`。
 * 其余字段留空而不是编造——编出来的 messageId 会被 `getNativeMessage` 查空，
 * 那时 memory admission 与 Skills 收据都会正确地什么也不做。
 * ============================================================ */
const WARM_TURN_KIND: TurnOrigin = {
  kind: "manual",
  queryText: "",
  userText: "",
  userMessageId: "",
};

export type AgentConnectionWarmPorts = {
  connections: {
    enabled(): boolean;
    warm(plan: ConnectionLaunchPlan): void;
  };
  incarnationOf(conversationId: string): string | undefined;
  /** 会话的 canonical 选项；空白会话落到后端默认，两者都没有才放弃。 */
  turnOptionsFor(
    conversationId: string,
    backend: AgentBackendId
  ): AgentTurnOptions | undefined;
  artifactDirectoryFor(conversationId: string): Promise<string | undefined>;
  disabledTools(): readonly string[];
  registry?: Pick<
    typeof backendRuntimeRegistry,
    "resolveForSpawn" | "confirmForSpawn"
  >;
};

/**
 * 走与第一轮同一条链，只是没有 payload：registry CAS → context → 运行时重投影
 * → 第三方计划 → 内置工具广告面 → 同一个 `chatConnectionPlan`。
 *
 * 只到 `initialize`：`session/load` 归第一轮（PRD §4.3）。任何一步说不出确定
 * 答案就直接返回——预热失败的代价只是下一轮回到冷路径，不该有第二个后果。
 */
export async function warmAgentConnection(
  options: AgentBridgeOptions,
  ports: AgentConnectionWarmPorts,
  intent: WarmIntent
) {
  if (!ports.connections.enabled()) return;
  const turnOptions = ports.turnOptionsFor(intent.conversationId, intent.backend);
  if (!turnOptions || turnOptions.backend !== intent.backend) return;
  const context = await options.resolveContext(intent.conversationId);
  /* App 绑定会话 v1 不入池（PRD §1）：processEnv 逐轮由 App runtime 解析。 */
  if (context.appId) return;
  const registry = ports.registry ?? backendRuntimeRegistry;
  const snapshot = await registry.resolveForSpawn(intent.backend);
  if (snapshot.runtimeStatus !== "installed") return;
  if (!(await registry.confirmForSpawn(intent.backend, snapshot))) return;
  const finalized =
    (await options.finalizeContextForRuntime?.(context, snapshot)) ?? context;
  const backendRuntimeIdentity = `${intent.backend}@${snapshot.runtime.version}`;
  /* Plan 档是逐条消息的草稿状态，canonical 选项里没有它：按非 Plan 预热，
     Plan 模式的首条消息自然落回冷路径（键不同，连接不会被认领）。 */
  const plan = chatConnectionPlan(
    {
      conversationId: intent.conversationId,
      turnOptions,
      context: finalized,
      runtime: snapshot.runtime,
      runtimeGeneration: snapshot.generation,
      allowedTools: projectBuiltinTools({
        builtinTools: snapshot.capabilities.builtinTools,
        backend: intent.backend,
        planMode: false,
        origin: WARM_TURN_KIND,
        disabledTools: ports.disabledTools(),
      }),
      ...(await warmArtifactDirectory(ports, intent.conversationId)),
      ...warmThirdPartyMcpPlan(options, {
        backendRuntimeIdentity,
        backendId: intent.backend,
        context: finalized,
      }),
    },
    ports.incarnationOf
  );
  if (!plan) return;
  ports.connections.warm(plan);
}

async function warmArtifactDirectory(
  ports: AgentConnectionWarmPorts,
  conversationId: string
) {
  const artifactDirectory = await ports.artifactDirectoryFor(conversationId);
  return artifactDirectory ? { artifactDirectory } : {};
}

/* 交出计划本体而不是摘要：摘要进键，entries 进 spawn，只有同一个对象才
   保证常驻进程真的带着键所声明的那些 server 起来。 */
function warmThirdPartyMcpPlan(
  options: AgentBridgeOptions,
  input: {
    backendId: AgentBackendId;
    backendRuntimeIdentity: string;
    context: Parameters<NonNullable<AgentBridgeOptions["resolveThirdPartyMcpPlan"]>>[0]["context"];
  }
) {
  const plan = options.resolveThirdPartyMcpPlan?.({
    ...input,
    planMode: false,
    origin: WARM_TURN_KIND,
  });
  return plan ? { thirdPartyMcpPlan: plan } : {};
}

/**
 * registrar 要的 sink。预热永不抛给 renderer、永不重试：一次失败只意味着
 * 下一轮走冷路径，而那正是今天的行为。
 */
export function agentConnectionWarmSink(
  options: AgentBridgeOptions,
  ports: AgentConnectionWarmPorts
) {
  return {
    warm: (intent: WarmIntent) => {
      void warmAgentConnection(options, ports, intent).catch(() => undefined);
    },
  };
}
