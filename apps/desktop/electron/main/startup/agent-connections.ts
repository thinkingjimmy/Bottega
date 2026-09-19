/**
 * [INPUT]: Depends on Electron powerMonitor, the built-in MCP lease store, turn custody, the backend runtime registry singleton and the agent connection runtime
 * [OUTPUT]: Provides startAgentConnections — the resident-connection runtime plus its three ambient triggers (idle sweep, wake ping, runtime invalidation)
 * [POS]: Composition-root helper for index.ts; the runtime's lifetime is main's, not a window's, because it holds real processes that the custody journal reconciles per main life
 */

import { powerMonitor } from "electron";
import { backendRuntimeRegistry } from "../backends";
import {
  createAgentConnectionRuntime,
  type AgentConnectionRuntime,
} from "../agent/connection-runtime";
import type { AgentTurnCustodyRuntime } from "../backends/agent-turn-custody-runtime";
import type { BuiltinMcpLeaseStore } from "../tools/lease";

const IDLE_SWEEP_MS = 60_000;

export function startAgentConnections(ports: {
  enabled(): boolean;
  leases: BuiltinMcpLeaseStore;
  custody: AgentTurnCustodyRuntime;
  registry?: Pick<typeof backendRuntimeRegistry, "onInvalidated">;
}): AgentConnectionRuntime {
  const runtime = createAgentConnectionRuntime({
    enabled: ports.enabled,
    leases: ports.leases,
    beginCustody: (input) => ports.custody.begin(input),
  });
  /* 闲置淘汰是扫描而不是逐连接定时器：五分钟的粒度不值一组 timer，而一个
     不 unref 的 timer 会把退出拖到下一次 tick。 */
  const sweep = setInterval(
    () => void runtime.sweep().catch(() => undefined),
    IDLE_SWEEP_MS
  );
  sweep.unref?.();
  powerMonitor.on("resume", () => {
    void runtime.resume().catch(() => undefined);
  });
  /* 作废即整批关闭：CLI 换了文件、Recheck、登录返回都走这一条，不另立第二
     套判据（PRD §6.4）。 */
  (ports.registry ?? backendRuntimeRegistry).onInvalidated((backend) => {
    void runtime.invalidate(backend, "runtime-invalidated").catch(() => undefined);
  });
  return runtime;
}
