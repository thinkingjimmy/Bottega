/**
 * [INPUT]: Depends on LifecycleIntentStore's pending-intent listing and Node fs; reads the three staging roots under userData
 * [OUTPUT]: Provides sweepAppStaging, reclaiming any staging entry or pending app-config file an earlier run left (created before this process started) that no live pending intent references; an entry of this run or of unknown age is kept
 * [POS]: apps module's startup orphan sweep across the three staging roots (probe/share/preset) and pending configs; the probe/preview mapping lives only in process memory, so anything left after a crash is only ever recovered here
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";

/** probe/share/preset 三处 staging 根；对应各自 service 构造器里的同名常量。 */
const STAGING_ROOTS = ["app-probes", "app-share", "app-presets"] as const;

/**
 * 判定只有一条：路径被某个 pending intent 的 input.staging/packageRoot 引用即物证，
 * 其余一律垃圾。probe 预检、share 预览、preset 复制的内存映射不跨进程——
 * 崩溃/退出后它们的 staging 没有任何在线持有者，不清就是永久累积。
 */
/** When this process started: anything created at or after it belongs to a flow of this run, whose owner cleans it up. */
const processStartedAt = () => Date.now() - process.uptime() * 1_000;

/** Birth time where the file system records it, else change time; null when neither can be read. */
async function creationTime(path: string): Promise<number | null> {
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  const created = info.birthtimeMs > 0 ? info.birthtimeMs : info.ctimeMs;
  return Number.isFinite(created) && created > 0 ? created : null;
}

/**
 * The sweep runs in the deferred placement task, after the window and `apps:add` are open, so an Add App, share or preset
 * started by this run may already be writing its staging. Only what an earlier run left is reclaimed: an entry created
 * before this process started and referenced by no pending intent. An entry whose age cannot be read is kept.
 */
export async function sweepAppStaging(
  userData: string,
  intents: LifecycleIntentStore,
  { startedAt = processStartedAt(), createdAt = creationTime }: {
    startedAt?: number;
    createdAt?: (path: string) => Promise<number | null>;
  } = {}
) {
  const leftByEarlierRun = async (path: string) => {
    const created = await createdAt(path);
    return created !== null && created < startedAt;
  };
  const pending = await intents.listPending();
  const referenced: string[] = [];
  const requestIds = new Set<string>();
  for (const intent of pending) {
    requestIds.add(intent.requestId);
    for (const key of ["staging", "packageRoot"] as const) {
      const value = intent.input[key];
      if (typeof value === "string" && value) referenced.push(value);
    }
  }
  const isEvidence = (path: string) =>
    referenced.some(
      (evidence) => evidence === path || evidence.startsWith(`${path}/`)
    );
  for (const rootName of STAGING_ROOTS) {
    const root = join(userData, rootName);
    for (const entry of await readdir(root).catch(() => [] as string[])) {
      const path = join(root, entry);
      if (isEvidence(path) || !(await leftByEarlierRun(path))) continue;
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  // pending 配置文件名即 requestId；pending intent 之外的副本含 secret，必须回收
  const configRoot = join(userData, "app-config");
  for (const entry of await readdir(configRoot).catch(() => [] as string[])) {
    const match = /^pending-([A-Za-z0-9-]{10,80})\.json$/.exec(entry);
    if (match && !requestIds.has(match[1]!) && (await leftByEarlierRun(join(configRoot, entry)))) {
      await rm(join(configRoot, entry), { force: true }).catch(() => undefined);
    }
  }
}
