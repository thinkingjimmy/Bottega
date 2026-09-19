/**
 * [INPUT]: Depends on the resident supervisor lease, the connection-scoped built-in MCP lease store, turn custody, AcpTurn's connection accessor, AcpConnection's close and the connections pool/health modules
 * [OUTPUT]: Provides createAgentConnectionRuntime — the one place that turns a launch plan into a resident connection (slot, lease, custody, spawn, handshake), closes an already-spawned process when the handshake fails, and hands the rest of its lifecycle to the pool
 * [POS]: Composition seam between agent-bridge/main-window and backends/connections; the pool owns how long a connection lives, this module owns what one is made of
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";
import {
  acquireAgentResidentLease,
  type AgentResidentLease,
} from "../agent-process-supervisor";
import { AcpTurn } from "../backends/acp/acp-turn";
import type { AcpConnection } from "../backends/acp/connection/acp-connection";
import { AcpStartupTracker } from "../backends/acp/startup/budget";
import type { AgentTurnCustodyHandle } from "../backends/agent-turn-custody-runtime";
import { pingAcpConnection } from "../backends/connections/health";
import { AgentConnectionPool } from "../backends/connections/pool";
import type { ResidentConnection } from "../backends/connections/types";
import type { AgentProcessHost, AgentTurn } from "../backends/types";
import { asError } from "../errors";
import type {
  BuiltinMcpLeaseStore,
  BuiltinMcpTurnBinding,
  ConnectionBuiltinMcp,
} from "../tools/lease";
import type { BuiltinToolName } from "../../../shared/builtin-tools";
import { agentConnectionKey, type AgentConnectionIdentity } from "./launch-plan";

export type ConnectionLaunchPlan = Readonly<{
  identity: AgentConnectionIdentity;
  backendRuntimeIdentity: string;
  /** 缺席即这条连接不带内置工具：广告面为空，与键里的摘要一致。 */
  builtin?: Readonly<{
    chatId: string;
    incarnationId: string;
    allowedTools: readonly BuiltinToolName[];
    resultByteBudget: number;
  }>;
  /**
   * 造一个**只用来 spawn** 的 turn：它永不 start，只交出自己的私有连接。
   * 走 createTurn 而不是自己拼 spawn 三元组，是为了让预热与第一轮的围栏、
   * env、seatbelt 包装逐字同源——复制一份就等于埋一条会漂移的第二真相。
   */
  createTurn(input: {
    processHost?: AgentProcessHost;
    builtinMcp?: {
      server: import("../tools/lease").BuiltinMcpServerSpec;
      lease: import("../tools/lease").BuiltinMcpLease;
      waitReady(signal: AbortSignal): Promise<void>;
    };
  }): AgentTurn;
}>;

export type AgentConnectionRuntimePorts = {
  enabled(): boolean;
  leases: BuiltinMcpLeaseStore;
  beginCustody(input: {
    turnRequestId: string;
    owner: { kind: "connection"; ownerId: string; ownerRevision: number };
    backendRuntimeIdentity: string;
    dependencies: readonly never[];
  }): Promise<AgentTurnCustodyHandle>;
};

function acpConnectionOf(turn: AgentTurn) {
  if (!(turn instanceof AcpTurn)) {
    throw new Error("只有 ACP turn 能交出连接");
  }
  return turn.acpConnection;
}

export function createAgentConnectionRuntime(ports: AgentConnectionRuntimePorts) {
  const pool = new AgentConnectionPool({
    enabled: ports.enabled,
    ping: pingAcpConnection,
  });
  /* 同一条键的第 n 次重建必须是账本里可区分的 n：owner 相同而代次不同，
     上一条的遗留条目才不会被当成这一条的证据。 */
  const revisions = new Map<string, number>();

  const opener = (plan: ConnectionLaunchPlan) => async (): Promise<ResidentConnection> => {
    const ownerId = agentConnectionKey(plan.identity);
    const ownerRevision = (revisions.get(ownerId) ?? 0) + 1;
    revisions.set(ownerId, ownerRevision);
    const resident: AgentResidentLease = await acquireAgentResidentLease(
      plan.identity.backend
    );
    let builtinMcp: ConnectionBuiltinMcp | undefined;
    let custody: AgentTurnCustodyHandle | undefined;
    let connection: AcpConnection | undefined;
    try {
      builtinMcp = plan.builtin
        ? ports.leases.issueForConnection({
            chatId: plan.builtin.chatId,
            incarnationId: plan.builtin.incarnationId,
            allowedTools: [...plan.builtin.allowedTools],
            initiatorBackend: plan.identity.backend,
            resultByteBudget: plan.builtin.resultByteBudget,
          })
        : undefined;
      /* custody intent 先于 spawn：少了这一笔，main 崩溃后没有任何证据能
         说清那个常驻 CLI 进程是死是活。 */
      custody = await ports.beginCustody({
        turnRequestId: `connection:${ownerRevision}:${ownerId.slice(0, 64)}`,
        owner: { kind: "connection", ownerId, ownerRevision },
        backendRuntimeIdentity: plan.backendRuntimeIdentity,
        dependencies: [],
      });
      const turn = plan.createTurn({
        ...(custody ? { processHost: custody.host } : {}),
        ...(builtinMcp
          ? {
              builtinMcp: {
                server: builtinMcp.server,
                lease: builtinMcp.lease,
                waitReady: builtinMcp.waitReady,
              },
            }
          : {}),
      });
      const spawned = (connection = acpConnectionOf(turn));
      /* 预热只做到 initialize：session/load 留给第一轮（PRD §4.3）。 */
      await spawned.handshake(
        new AcpStartupTracker(spawned.evidence.waitForExit())
      );
      /* 造它的那个 turn 到此退场：它的 handler 槽必须让开，否则第一轮
         attach 会撞上"连接已被占用"。空槽期的语义正是我们要的——update
         丢弃计数，request 当场 method-not-found。 */
      spawned.detach();
      let closed: Promise<void> | undefined;
      return {
        connection: spawned,
        ...(builtinMcp ? { builtinMcp } : {}),
        resident,
        close: (reason) => {
          closed ??= (async () => {
            builtinMcp?.revoke();
            await custody?.beginRelease();
            await spawned.close(reason);
            await custody?.settle();
            resident.release();
          })();
          return closed;
        },
      };
    } catch (cause) {
      builtinMcp?.revoke();
      /* 进程在 createTurn 里就已经起来了（AcpTurn 的构造函数即 spawn），握手
         才是后面那一步。不在这里关掉它，失败留下的就是一个谁也不认领的 CLI
         进程——池里没有它的条目，池的收口也就永远碰不到它。 */
      await connection?.close("open-failed").catch(() => undefined);
      await custody?.abort("guardian-spawn-failed").catch(() => undefined);
      resident.release();
      throw new Error(
        `Agent 连接建立失败（${plan.identity.backend}）：${asError(cause).message}`
      );
    }
  };

  return {
    pool,
    /** 预热在建计划**之前**先问一次开关：关掉时连 context 都不该被解析。 */
    enabled: ports.enabled,
    warm(plan: ConnectionLaunchPlan) {
      pool.warm(plan.identity, opener(plan));
    },
    claim(plan: ConnectionLaunchPlan, turn: BuiltinMcpTurnBinding) {
      return pool.claim({ identity: plan.identity, turn, open: opener(plan) });
    },
    invalidate: (backend: AgentBackendId, reason?: string) =>
      pool.invalidate(backend, reason),
    resume: () => pool.resume(),
    sweep: () => pool.sweep(),
    close: () => pool.shutdown(),
  };
}

export type AgentConnectionRuntime = ReturnType<
  typeof createAgentConnectionRuntime
>;
