/**
 * [INPUT]: Depends on the process group signal capacity of Node process.kill, `ps` (live, non-zombie group members), custody's observeProcessBirth (only a read that proved the leader absent permits leaderless cleanup) and asError of main/errors
 * [OUTPUT]: Provides groupExists (a group of unreaped zombies has ended), wait, stopProcessGroup, cleanProcessGroup, CleanupResult, and the birth-verified cleanOwnedProcessGroup/OwnedProcessGroup and signalOwnedGroup (one SIGKILL, only to the group a launch identity names; a reused or gone one is ended) used before signalling any group a registry recorded earlier
 * [POS]: apps/desktop/electron/main/agent/process; Electron main's sole POSIX process-group lifecycle helper; pure functions consumed by agent-bridge, the auxiliary registry and the utility host's descendant registry
 */

import { execFileSync } from "node:child_process";
import { asError } from "../../ipc/errors";
import { observeProcessBirth, type BirthObservation } from "../../custody/identity";

const KILL_CONFIRM_TIMEOUT_MS = 3_000;
const CLEANUP_RETRY_COUNT = 3;

export type CleanupResult = { ok: true } | { ok: false; error: Error };

/* A group whose members have all exited while its leader is not yet reaped answers kill(-pgid) with EPERM on macOS. Such a group
   runs nothing: only members that are not zombies count. */
function liveGroupMembers(pgid: number) {
  return execFileSync("ps", ["-axo", "pid=,pgid=,stat="], { encoding: "utf8" }).split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([pid, group, stat]) => pid && Number(group) === pgid && !stat?.startsWith("Z")).length;
}

export function groupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    return code === "EPERM" ? liveGroupMembers(pid) > 0 : true;
  }
}

/* A signal that finds the group already ended is not a failure. */
function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH" && groupExists(pid)) throw error;
  }
}

export const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// ============================================================
// SIGTERM 宽限 → SIGKILL 确认，任何一步存活超时即抛错
// ============================================================

export async function stopProcessGroup(pid: number) {
  signalGroup(pid, "SIGTERM");
  for (let elapsed = 0; elapsed < 3_000; elapsed += 500) {
    if (!groupExists(pid)) return;
    await wait(500);
  }
  signalGroup(pid, "SIGKILL");
  for (
    let elapsed = 0;
    elapsed < KILL_CONFIRM_TIMEOUT_MS;
    elapsed += 500
  ) {
    if (!groupExists(pid)) return;
    await wait(500);
  }
  throw new Error(`进程组 ${pid} 在 SIGKILL 后仍未退出`);
}

/** 带重试的清理；只报告结果，安全锁等策略由调用方决定。 */
export async function cleanProcessGroup(pid: number): Promise<CleanupResult> {
  let lastError = new Error("未知进程组清理错误");
  for (let attempt = 0; attempt < CLEANUP_RETRY_COUNT; attempt += 1) {
    try {
      await stopProcessGroup(pid);
      return { ok: true };
    } catch (cause) {
      lastError = asError(cause);
      if (attempt + 1 < CLEANUP_RETRY_COUNT) await wait(250);
    }
  }
  return { ok: false, error: lastError };
}

/* ============================================================
 * Birth-verified cleanup of a group recorded earlier. A PID can
 * be reused, a group id cannot while the group still has a
 * member, which gives three verdicts:
 *   leader alive, same birth      → ours: clean the group
 *   leader alive, other birth     → reused: our group is gone, never signal
 *   leader gone, group still live → ours: members outlived the leader
 * "Leader gone" needs a read that proved it (B2-02); a failed or
 * unparseable read is unverified and nothing is signalled.
 * ============================================================ */
export type OwnedProcessGroup = Readonly<{ pid: number; birthIdentity: string | null }>;
export type OwnedCleanupResult = CleanupResult & { verdict: "cleaned" | "gone" | "reused" | "unverified" };

type Probe = (pid: number) => BirthObservation;
/** The one ownership check, made before any signal and never from whoever holds the PID now: gone, reused, unverified or ours. */
function ownership(group: OwnedProcessGroup, probe: Probe, exists: (pid: number) => boolean) {
  const now = probe(group.pid);
  if (now.state === "unverified") return "unverified";
  if (now.state === "absent") return exists(group.pid) ? "ours" : "gone";
  if (group.birthIdentity === null) return "unverified";
  if (now.birthIdentity !== group.birthIdentity) return "reused";
  return now.processGroupId === group.pid ? "ours" : "unverified";
}

/**
 * One SIGKILL, only to the group a launch identity names (B-01): `signalled`, else why not — `gone` or `reused` (both ended),
 * `unverified` (never signalled), or `refused` (the signal was denied, EPERM: not stopped and not an error; judge again).
 */
export function signalOwnedGroup(group: OwnedProcessGroup | null, ports: { probe: Probe; exists: (pid: number) => boolean; signal: (pid: number) => void }) {
  const verdict = group ? ownership(group, ports.probe, ports.exists) : "unverified";
  if (verdict !== "ours") return verdict;
  try { ports.signal(group!.pid); } catch { return "refused"; }
  return "signalled";
}

export async function cleanOwnedProcessGroup(
  group: OwnedProcessGroup,
  probe: Probe = observeProcessBirth,
  clean: (pid: number) => Promise<CleanupResult> = cleanProcessGroup,
  exists: (pid: number) => boolean = groupExists
): Promise<OwnedCleanupResult> {
  const verdict = ownership(group, probe, exists);
  if (verdict === "ours") return { ...(await clean(group.pid)), verdict: "cleaned" };
  /* A live PID that cannot be proven ours is never signalled, and its owner stays locked. */
  return verdict === "unverified" ? { ok: false, verdict, error: new Error(`process group ${group.pid} cannot be proven ours`) } : { ok: true, verdict };
}
