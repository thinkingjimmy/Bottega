/**
 * [INPUT]: Depends on the lifecycle intent store of the pending listing with Node fs; Staging Roots under the userData
 * [OUTPUT]: Provides sweepAppStaging The recycling of the app is not subject to any pending intent reference to the staging directory and pending configuration
 * [POS]: The first is the "Works Clean" app moduleThe probe/preview mapping is the process memory, and the staging of the journal that is not entered after the restart is only recovered here
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
