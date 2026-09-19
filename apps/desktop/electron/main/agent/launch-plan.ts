/**
 * [INPUT]: Depends on node:crypto, shared AgentBackendId/TurnFilesystemAccess/SubagentRegistry, the backends descriptor/ResolvedRuntime contracts and the connection runtime's launch-plan shape
 * [OUTPUT]: Provides AgentConnectionIdentity, agentConnectionIdentity (the poolability decision), agentConnectionKey and connectionLaunchPlan — the single derivation of "which process may serve this turn" and of how that process is started, including the one place the third-party MCP digest is taken from the plan that is actually spawned
 * [POS]: The anti-drift seam between agent-bridge's createTurn and backends/connections' pool; both sides derive the connection key here, never locally
 */

import { createHash } from "node:crypto";
import type {
  AgentBackendId,
  AgentTurnOptions,
  TurnFilesystemAccess,
} from "../../../shared/agent-ipc";
import type { BuiltinToolName } from "../../../shared/builtin-tools";
import type { ThirdPartyMcpPlan } from "../../../shared/mcp-servers-ipc";
import { SubagentRegistry } from "../../../shared/subagent-registry";
import type {
  BackendDescriptor,
  BackendTurnOptions,
  ResolvedRuntime,
} from "../backends/types";
import type { ConnectionLaunchPlan } from "./connection-runtime";

export type AgentConnectionIdentity = Readonly<{
  backend: AgentBackendId;
  workspace: string;
  permissionMode: string;
  /** executable@version：CLI 换了文件或版本即换连接。 */
  runtimeIdentity: string;
  authGeneration: number;
  /** 围栏 + 产物目录 + 第三方计划 + 内置工具广告面 + App 环境的合并摘要。 */
  fence: string;
}>;

export type AgentConnectionIdentityInput = {
  backend: AgentBackendId;
  workspace: string;
  permissionMode: string;
  runtime: ResolvedRuntime;
  runtimeGeneration: number;
  /** App 绑定会话在 v1 不进池：processEnv 逐轮由 App runtime 解析，custody 也另有 owner。 */
  appId?: string;
  filesystemAccess?: TurnFilesystemAccess & { controlRoot: string };
  artifactDirectory?: string;
  /** 只由 `connectionLaunchPlan` 从计划推导，调用方给不了一个与 spawn 不符的值。 */
  thirdPartyPlanDigest?: string;
  /**
   * 内置 MCP 的**广告面**。它在 spec env 里随子进程启动一次性交给 CLI，
   * 逐轮改不了——所以它进键：Plan 档切换或内置工具政策变化即换连接。
   */
  builtinAdvertisement?: {
    allowedTools: readonly string[];
    resultByteBudget: number;
  };
  processEnv?: NodeJS.ProcessEnv;
};

const SEPARATOR = String.fromCharCode(0);

const digest = (parts: readonly string[]) =>
  createHash("sha256").update(parts.join(SEPARATOR)).digest("hex").slice(0, 32);

function envDigest(env: NodeJS.ProcessEnv | undefined) {
  if (!env) return "";
  return digest(
    Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
  );
}

/**
 * 返回 undefined 即「本轮不可入池」，调用方走冷路径。
 *
 * 不可入池的判据必须在这里**一次**说清：散到 bridge 与池两处，漏掉的那一处
 * 就是复用了不该复用的进程——而围栏正是在 spawn 时按这些输入绑定的。
 */
export function agentConnectionIdentity(
  input: AgentConnectionIdentityInput
): AgentConnectionIdentity | undefined {
  if (input.appId) return undefined;
  if (!input.workspace) return undefined;
  const access = input.filesystemAccess;
  return {
    backend: input.backend,
    workspace: input.workspace,
    permissionMode: input.permissionMode,
    runtimeIdentity: `${input.runtime.executable}@${input.runtime.version}`,
    authGeneration: input.runtimeGeneration,
    fence: digest([
      access?.workspace ?? "",
      ...[...(access?.readOnlyRoots ?? [])].sort(),
      access?.controlRoot ?? "",
      input.artifactDirectory ?? "",
      input.thirdPartyPlanDigest ?? "",
      ...[...(input.builtinAdvertisement?.allowedTools ?? [])].sort(),
      String(input.builtinAdvertisement?.resultByteBudget ?? ""),
      envDigest(input.processEnv),
    ]),
  };
}

export function agentConnectionKey(identity: AgentConnectionIdentity) {
  return [
    identity.backend,
    identity.workspace,
    identity.permissionMode,
    identity.runtimeIdentity,
    String(identity.authGeneration),
    identity.fence,
  ].join(SEPARATOR);
}


/* ============================================================
 * 连接的启动计划。
 *
 * 它刻意**不**自己拼 spawn 三元组：那份三元组由后端描述符的 createTurn
 * 产出（围栏包装、backend env、seatbelt 都在那里），池只是把它构造出来的
 * 私有连接接管过去。预热与第一轮因此逐字同源。
 *
 * 下面这张表是"起一个进程需要哪些输入"的唯一清单，必须与 agent-bridge 的
 * createTurn 调用保持一致；`fence` 摘要是它的守卫——任何没进摘要的 spawn
 * 输入都不该被复用。
 * ============================================================ */
export type ConnectionPlanInput = Omit<
  AgentConnectionIdentityInput,
  "thirdPartyPlanDigest"
> & {
  descriptor: BackendDescriptor;
  turnOptions: AgentTurnOptions;
  /**
   * 第三方 MCP 的**计划本体**，不是它的摘要：摘要进键、entries 进 spawn，
   * 两者必须出自同一个对象，否则池会认为常驻进程带着这些 server 起来过。
   */
  thirdPartyMcpPlan?: ThirdPartyMcpPlan;
  backendSessionConfig?: BackendTurnOptions["backendSessionConfig"];
  serverFactBinding?: BackendTurnOptions["serverFactBinding"];
  builtin?: Readonly<{
    chatId: string;
    incarnationId: string;
    allowedTools: readonly BuiltinToolName[];
    resultByteBudget: number;
  }>;
};

/** 永不 start 的 turn 仍要有形状完整的选项；这些格子只在 start() 里被读。 */
const IDLE_INPUT: BackendTurnOptions["input"] = {
  input: [],
  commit: () => undefined,
  rollback: () => undefined,
  release: async () => undefined,
};

const IDLE_CALLBACKS: BackendTurnOptions["callbacks"] = {
  onThread: async () => undefined,
  onItemDelta: () => undefined,
  onItem: () => undefined,
  onItemRemoved: () => undefined,
  onApproval: () => undefined,
  onApprovalClosed: () => undefined,
  onTerminal: () => undefined,
  onProcessError: () => undefined,
};

export function connectionLaunchPlan(
  input: ConnectionPlanInput
): ConnectionLaunchPlan | undefined {
  const identity = agentConnectionIdentity({
    ...input,
    ...(input.thirdPartyMcpPlan
      ? { thirdPartyPlanDigest: input.thirdPartyMcpPlan.planDigest }
      : {}),
  });
  if (!identity) return undefined;
  return {
    identity,
    backendRuntimeIdentity: `${input.backend}@${input.runtime.version}`,
    ...(input.builtin ? { builtin: input.builtin } : {}),
    createTurn: (extra) =>
      input.descriptor.createTurn({
        payload: {
          requestId: `connection:${identity.fence}`,
          scope: { conversationId: "" },
          input: [],
          turnOptions: input.turnOptions,
        } as unknown as BackendTurnOptions["payload"],
        input: IDLE_INPUT,
        callbacks: IDLE_CALLBACKS,
        runtime: input.runtime,
        workspace: input.workspace,
        subagents: new SubagentRegistry(),
        ...(input.filesystemAccess
          ? { filesystemAccess: input.filesystemAccess }
          : {}),
        ...(input.artifactDirectory
          ? { artifactDirectory: input.artifactDirectory }
          : {}),
        ...(input.processEnv ? { processEnv: input.processEnv } : {}),
        ...(input.thirdPartyMcpPlan
          ? { thirdPartyMcpPlan: input.thirdPartyMcpPlan }
          : {}),
        ...(input.backendSessionConfig
          ? { backendSessionConfig: input.backendSessionConfig }
          : {}),
        ...(input.serverFactBinding
          ? { serverFactBinding: input.serverFactBinding }
          : {}),
        ...extra,
      }),
  };
}
