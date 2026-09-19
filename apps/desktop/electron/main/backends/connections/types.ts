/**
 * [INPUT]: Depends on AcpConnection, the connection-scoped built-in MCP lease, the supervisor resident lease and the shared AgentConnectionIdentity
 * [OUTPUT]: Provides ResidentConnection, AgentConnectionOpener, AgentConnectionPoolPorts and ClaimedAgentConnection — the resources the pool owns lifecycle over but never constructs itself
 * [POS]: Contract module of backends/connections; how a process is actually started (descriptor, fence, custody, lease) stays with the composition root
 */

import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { AgentConnectionIdentity } from "../../agent/launch-plan";
import type { AgentResidentLease } from "../../agent-process-supervisor";
import type { AcpConnection } from "../acp/connection/acp-connection";
import type {
  BuiltinMcpTurnBinding,
  ConnectionBuiltinMcp,
} from "../../tools/lease";

/** 一条常驻连接的全部资源：进程、内置工具 lease、槽位、custody。 */
export type ResidentConnection = {
  readonly connection: AcpConnection;
  readonly builtinMcp?: ConnectionBuiltinMcp;
  readonly resident: AgentResidentLease;
  /** 收口全部四样；幂等。 */
  close(reason: string): Promise<void>;
};

/**
 * 起进程 + custody + 握手 + 连接级 lease。
 *
 * 它是调用方传进来的闭包而不是池的端口：能产出这份计划的只有组合根，而池
 * 连"计划"长什么样都不该知道——它管的是这条连接活多久，不是它怎么来的。
 */
export type AgentConnectionOpener = () => Promise<ResidentConnection>;

export type AgentConnectionPoolPorts = {
  /** Lab 总开关，**每次**认领/预热/归还都重新读，不缓存。 */
  enabled(): boolean;
  /** 休眠唤醒后的验活；缺省是 `session/list`（四家都支持且无副作用）。 */
  ping?(connection: AcpConnection): Promise<void>;
  now?(): number;
};

export type ClaimedAgentConnection = {
  connection: AcpConnection;
  builtinMcp?: ConnectionBuiltinMcp;
  /** turn 终态时归还；`dead` 表示进程或 transport 在本轮内死了。 */
  release(outcome?: "reusable" | "dead"): Promise<void>;
};

export type AgentConnectionClaim = {
  identity: AgentConnectionIdentity;
  turn: BuiltinMcpTurnBinding;
  open: AgentConnectionOpener;
};

export type AgentConnectionSnapshot = Readonly<{
  backend: AgentBackendId;
  phase: "warming" | "idle" | "busy" | "draining" | "closed";
  pid: number | undefined;
  idleSince: number;
}>;
