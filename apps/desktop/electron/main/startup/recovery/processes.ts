/**
 * [INPUT]: Depends on the existing process birth probe, a complete same-user process inventory, /usr/sbin/lsof for each guardian's cwd and the lsof -F parser from apps/runtime/listener-audit.
 * [OUTPUT]: Captures surviving guardians of this profile and verifies saved PID identities have exited without signalling them. isGuardianCommand (by entry file, whatever runs it); guardianProfile (ours / other / unknown from a guardian's cwd).
 * [POS]: Corrupt-custody evidence probe; failed or incomplete observation never opens execution or cleanup, and another profile's guardian is excluded only on positive evidence.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseLsofListeners } from "../../apps/runtime/listener-audit";
import { probeProcessBirth, type ProcessBirth } from "../../custody/identity";
export type RecoveryProcess = ProcessBirth & { pid: number };
const exists = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
};
/** A guardian by its entry file, whatever runs it (Electron before TASK-35, the bundled Node after) and wherever its bundle is (G1, U1). */
export const isGuardianCommand = (command: string) => /(?:^|[/\\])(?:custody-guardian-entry|custody[/\\]guardian-entry)\.(?:js|ts)(?:\s|$)/.test(command);
/* A guardian runs with its control root as cwd (custody/attachment.ts), and every control root is one of these directly under its
   profile's userData: that cwd is the only profile identity a guardian carries (its argv names none, its socket env is deleted). */
const CUSTODY_ROOTS = new Set(["agent-custody", "host-custody"]);
const LSOF = "/usr/sbin/lsof";
const LSOF_TIMEOUT_MS = 30_000;
const PROBE_ENV = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
const real = (path: string) => { try { return realpathSync(path); } catch { return null; } };
/**
 * Whose guardian this is, from its cwd. `other` only on positive evidence: the cwd is a custody root, and its profile is not this one.
 * Anything else (outside every custody root, deleted, not reported) is `unknown`, and an unknown guardian holds.
 */
export function guardianProfile(cwd: string | undefined, userData: string): "ours" | "other" | "unknown" {
  const where = cwd ? real(cwd) : null;
  if (!where || !CUSTODY_ROOTS.has(basename(where))) return "unknown";
  /* A control root sits directly under its userData: comparing the parent exactly also keeps /x/Bottega from claiming /x/Bottega Dev. */
  return dirname(where) === (real(userData) ?? resolve(userData)) ? "ours" : "other";
}
/** Each pid's cwd, by one lsof call; null when lsof could not run or answer, which leaves the inventory incomplete. */
function guardianCwds(pids: readonly number[]): Map<number, string> | null {
  /* Generous on purpose: it runs only while something is held, and a timeout reads as incomplete, which holds everything. */
  const result = spawnSync(LSOF, ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")], { encoding: "utf8", env: PROBE_ENV, timeout: LSOF_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  /* lsof exits 1 when a listed pid has gone meanwhile; its answer for the rest still stands, and the missing ones read as unknown. */
  if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) return null;
  return new Map(parseLsofListeners(result.stdout).map(({ pid, endpoint }) => [pid, endpoint]));
}
/** Every same-user process whose command line is a guardian entry; null when ps could not answer. */
function guardianCandidates(): number[] | null {
  const result = spawnSync("ps", ["-axo", "uid=,pid=,command="], { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return null;
  const pids: number[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (match && Number(match[1]) === process.getuid?.() && isGuardianCommand(match[3]!)) pids.push(Number(match[2]));
  }
  return pids;
}
const reportedUnknown = new Set<number>();
/**
 * `userData` scopes the machine-wide guardian candidates to this profile; without it every guardian counts (the old, fail-closed scope).
 * The ledger's own pids always count, whatever their cwd: they are this profile's intents, and may be backends rather than guardians.
 */
export function inspectRecoveryProcesses(bytes = "", userData?: string, ports: {
  /** The same-user guardian candidates, instead of reading ps (tests); null reads as an incomplete inventory. */
  guardians?: () => readonly number[] | null;
  cwds?: (pids: readonly number[]) => Map<number, string> | null } = {}):
  { complete: boolean; processes: RecoveryProcess[] } {
  if (process.platform === "win32") return { complete: false, processes: [] };
  const candidates = (ports.guardians ?? guardianCandidates)();
  if (!candidates) return { complete: false, processes: [] };
  const pids = new Set<number>(), guardians = [...candidates];
  if (userData && guardians.length) {
    const cwds = (ports.cwds ?? guardianCwds)(guardians);
    if (!cwds) return { complete: false, processes: [] };
    for (const pid of guardians) {
      const profile = guardianProfile(cwds.get(pid), userData);
      if (profile === "other") continue;
      if (profile === "unknown" && !reportedUnknown.has(pid)) {
        reportedUnknown.add(pid);
        console.warn(`[startup] guardian-profile-unknown pid=${pid} cwd=${cwds.get(pid) ?? "none"}: held until it exits`);
      }
      pids.add(pid);
    }
  } else for (const pid of guardians) pids.add(pid);
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
