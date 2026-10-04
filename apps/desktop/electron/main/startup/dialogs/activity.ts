/**
 * [INPUT]: Current stop operations, host-custody entries, birth-qualified process observations and auxiliary supervision.
 * [OUTPUT]: Counts tasks separately from tracked processes that have not confirmed exit, excluding proven absent or reused PIDs.
 * [POS]: Quit feedback reads live custody facts; stale safety-lock text is never treated as evidence of running work.
 */
import type { HostCustodyEntry } from "../../host/processes/custody";
import type { StopOperation } from "../../presence/lifecycle/start-fence";
import { observeProcessBirth } from "../../custody/identity";
import { agentShutdownProcesses } from "../../agent-process-supervisor";

export function quitActivity(operations: readonly StopOperation[], entries: readonly HostCustodyEntry[]) {
  const tasks = new Set(operations.map(operation => operation.requestId ?? operation.operationId));
  const processes = new Set(agentShutdownProcesses());
  for (const entry of entries) {
    if (entry.phase === "released" || entry.phase === "aborted" || !entry.processIdentity) continue;
    const { pid, birthIdentity } = entry.processIdentity;
    const observation = observeProcessBirth(pid);
    if (observation.state === "absent" || (observation.state === "present" && observation.birthIdentity !== birthIdentity)) continue;
    processes.add(`${pid}:${birthIdentity}`);
    if (entry.requestId) tasks.add(entry.requestId);
  }
  return { tasks: tasks.size, processes: processes.size };
}
