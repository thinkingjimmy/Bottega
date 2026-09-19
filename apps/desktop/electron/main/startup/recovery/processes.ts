/**
 * [INPUT]: Depends on the existing process birth probe and a complete same-user process inventory.
 * [OUTPUT]: Captures surviving guardians and verifies saved PID identities have exited without signalling them.
 * [POS]: Corrupt-custody evidence probe; failed or incomplete observation never opens execution or cleanup.
 */
import { spawnSync } from "node:child_process";
import { probeProcessBirth, type ProcessBirth } from "../../custody/identity";
export type RecoveryProcess = ProcessBirth & { pid: number };
const exists = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
};
export function inspectRecoveryProcesses(bytes = ""): { complete: boolean; processes: RecoveryProcess[] } {
  if (process.platform === "win32") return { complete: false, processes: [] };
  const result = spawnSync("ps", ["-axo", "uid=,pid=,command="], { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return { complete: false, processes: [] };
  const pids = new Set<number>();
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (match && Number(match[1]) === process.getuid?.() && /(?:^|[/\\])(?:custody-guardian-entry|custody[/\\]guardian-entry)\.(?:js|ts)(?:\s|$)/.test(match[3]!)) pids.add(Number(match[2]));
  }
  for (const match of bytes.matchAll(/"(?:pid|processGroupId)"\s*:\s*(\d+)/g)) {
    const pid = Number(match[1]); if (Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
    if (pids.size > 4096) return { complete: false, processes: [] };
  }
  const processes: RecoveryProcess[] = [];
  for (const pid of pids) {
    if (!exists(pid)) continue;
    const birth = probeProcessBirth(pid); if (!birth) return { complete: false, processes };
    processes.push({ pid, ...birth });
  }
  return { complete: true, processes };
}
export function recoveryProcessHasExited(original: RecoveryProcess) {
  if (!exists(original.pid)) return true;
  const birth = probeProcessBirth(original.pid);
  return Boolean(birth && (birth.birthIdentity !== original.birthIdentity || birth.processGroupId !== original.processGroupId));
}
