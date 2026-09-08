/**
 * [INPUT]: Depends on LifecycleIntentStore's pending-intent listing and Node fs; reads the three staging roots under userData
 * [OUTPUT]: Provides sweepAppStaging, reclaiming any staging entry or pending app-config file not referenced by a live pending intent
 * [POS]: apps module's startup orphan sweep across the three staging roots (probe/share/preset) and pending configs; the probe/preview mapping lives only in process memory, so anything left after a crash is only ever recovered here
 */

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";

/** probe/share/preset 三处 staging 根；对应各自 service 构造器里的同名常量。 */
const STAGING_ROOTS = ["app-probes", "app-share", "app-presets"] as const;

/**
 * 判定只有一条：路径被某个 pending intent 的 input.staging/packageRoot 引用即物证，
 * 其余一律垃圾。probe 预检、share 预览、preset 复制的内存映射不跨进程——
 * 崩溃/退出后它们的 staging 没有任何在线持有者，不清就是永久累积。
 */
export async function sweepAppStaging(
  userData: string,
  intents: LifecycleIntentStore
) {
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
      if (isEvidence(path)) continue;
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  // pending 配置文件名即 requestId；pending intent 之外的副本含 secret，必须回收
  const configRoot = join(userData, "app-config");
  for (const entry of await readdir(configRoot).catch(() => [] as string[])) {
    const match = /^pending-([A-Za-z0-9-]{10,80})\.json$/.exec(entry);
    if (match && !requestIds.has(match[1]!)) {
      await rm(join(configRoot, entry), { force: true }).catch(() => undefined);
    }
  }
}
