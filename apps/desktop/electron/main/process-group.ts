/**
 * [INPUT]: Depends on the process group signal capacity of Node process.kill and asError of main/errors
 * [OUTPUT]: Provides groupExists, wait, stopProcessGroup, cleanProcessGroup and CleanupResult
 * [POS]: The only source of the POSIX processor lifecycle of Electron main, the pure function is modular-free, and is consumed by agent-bridge/apps/repair as a whole
 */

import { asError } from "./errors";

const KILL_CONFIRM_TIMEOUT_MS = 3_000;
const CLEANUP_RETRY_COUNT = 3;

export type CleanupResult = { ok: true } | { ok: false; error: Error };

export function groupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// ============================================================
// SIGTERM 宽限 → SIGKILL 确认，任何一步存活超时即抛错
// ============================================================

export async function stopProcessGroup(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  for (let elapsed = 0; elapsed < 3_000; elapsed += 500) {
    if (!groupExists(pid)) return;
    await wait(500);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
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
