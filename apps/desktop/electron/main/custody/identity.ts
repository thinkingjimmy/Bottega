/**
 * [INPUT]: Depends on POSIX `ps` The field pgid/lstart is associated with Node fs realpath/stat
 * [OUTPUT]: Provides probeProcessBirth (PID) and executableIdentity (document identity)
 * [POS]: The process of custody is processed by a process authenticatorThe only source of truth about whether or not to kill is "uncertainty", and I'm not sure
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
export function probeProcessBirth(
  pid: number,
  run = spawnSync
): ProcessBirth | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const result = run("ps", ["-o", "pgid=,lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return null;
  const line = String(result.stdout ?? "").trim();
  if (!line) return null;
  const separator = line.search(/\s/);
  if (separator <= 0) return null;
  const processGroupId = Number(line.slice(0, separator));
  const birthIdentity = line.slice(separator).trim();
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0) return null;
  if (!birthIdentity) return null;
  return { processGroupId, birthIdentity };
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
