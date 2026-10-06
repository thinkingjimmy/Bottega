/**
 * [INPUT]: Depends on the POSIX `ps` pgid/lstart fields and Node fs realpath/stat
 * [OUTPUT]: Provides observeProcessBirth (present with process-group id and birth, including macOS's transient ? state / absent, proven by a successful read / unverified: the read failed, timed out or could not be parsed), probeProcessBirth (the nullable capture shape over it) and executableIdentity (realpath+dev/ino/size fingerprint of a binary)
 * [POS]: Custody's process-identity evidence leaf; the sole rule governing whether to kill is that an inconclusive probe must never be treated as confirmed exit
 */

import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";

export type ProcessBirth = {
  processGroupId: number;
  /** OS 记录的进程创建时刻；PID 复用后必然不同 */
  birthIdentity: string;
};

/**
 * 一次 `ps` 同时取回进程组与创建时刻。字段顺序是刻意的：`lstart` 自带空格
 * （"Mon Aug 10 17:08:11 2026"），放在最后才能用「首 token 是 pgid、其余是
 * lstart」这条无歧义规则解析，不必猜列宽。
 *
 * 返回 `null` = 「说不清」：进程不存在、`ps` 不可用、输出不认识全部落在这里。
 * 调用方必须把它当成**不得发信号**，而不是「已经退出」——后者会在 PID 被复用
 * 时杀掉无辜进程，前者只是让 custody 留在 quarantine。
 */
export function probeProcessBirth(pid: number, run = spawnSync): ProcessBirth | null {
  const observed = observeProcessBirth(pid, run);
  return observed.state === "present" ? { processGroupId: observed.processGroupId, birthIdentity: observed.birthIdentity } : null;
}

/**
 * What one `ps` read proves (B2-02): `present` with the leader's group and birth, `absent` only when ps ran and answered "no
 * such process" (exit 1, nothing printed) or showed a zombie (killed, not yet reaped: it cannot run and its PID is not reusable), `unverified` for everything else — a spawn error, a timeout, another failure or
 * output it cannot parse. Only `absent` may count as the leader being gone; `unverified` authorizes no signal.
 */
export type BirthObservation = ({ state: "present" } & ProcessBirth) | { state: "absent" } | { state: "unverified" };
export function observeProcessBirth(pid: number, run = spawnSync): BirthObservation {
  const unverified = { state: "unverified" } as const;
  if (!Number.isSafeInteger(pid) || pid <= 0) return unverified;
  /* `lstart` follows the caller's locale and time zone ("五  9月/25 …" under zh_CN). Two processes
     comparing a recorded birth must print it identically, or a live owner reads as a reused PID. */
  const result = run("ps", ["-o", "pgid=,stat=,lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  });
  if (result.error || result.signal) return unverified;
  const line = String(result.stdout ?? "").trim();
  if (result.status === 1 && !line && !String(result.stderr ?? "").trim()) return { state: "absent" };
  if (result.status !== 0 || !line) return unverified;
  const match = /^(\d+)\s+(\S+)\s+(.+)$/.exec(line);
  if (!match) return unverified;
  const processGroupId = Number(match[1]), status = match[2]!, birthIdentity = match[3]!.trim();
  /* macOS can retain PGID and birth after the Mach thread state disappears (?Es while exiting).
     This still identifies the process; the unknown run state is not evidence that it has ended. */
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0 || !/^[IRSTUZ?][A-Za-z<>+]*$/.test(status) || !birthIdentity) return unverified;
  /* A zombie (killed, not yet reaped by its parent) can no longer run, and its PID cannot be reused until it is reaped: it is gone. */
  if (status.startsWith("Z")) return { state: "absent" };
  return { state: "present", processGroupId, birthIdentity };
}

/**
 * 可执行文件身份：realpath + dev/ino/size。与 runtime-registry 的 CLI 身份围栏
 * 同一套判据，用途也一样——证明「journal 里那条记录说的是这个二进制」。
 *
 * 它不参与 kill 判定：活进程的 PID 复用只有 birth 能证伪，而 `ps -o comm=` 的
 * 输出本身可被参数伪装。这里只把它作为不可否认的取证字段落账。
 */
export function executableIdentity(path: string): string {
  try {
    const real = realpathSync(path);
    const stat = statSync(real);
    return `${real}:${stat.dev}:${stat.ino}:${stat.size}`;
  } catch {
    return `${path}:unresolved`;
  }
}
