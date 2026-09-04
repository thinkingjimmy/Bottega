/**
 * [INPUT]: Depends on Node fs/path, snapshot tree test and journal/AppRecord type
 * [OUTPUT]: Provides the RepairSite interface, the stagingSite/copySite policies, repairSiteFor, and exists
 * [POS]: The whole staging-vs-copy difference of install/repair lives here, so the runner never branches on site kind
 */

import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppRecord } from "../../../../../shared/apps-ipc";
import type { RepairJournal } from "./journal";
import { assertSameTree, snapshotTree } from "./snapshot";

export type SwapDisposition = "rollback" | "forward" | "locked";
export type SwapPresence = { dir: boolean; workspace: boolean; trash: boolean };

export type SiteRoots = { userData: string; appsRoot: string };
export type SiteHooks = {
  stopRuntime: () => Promise<void>;
  clone: () => Promise<void>;
};
export type SiteContext = { record: AppRecord; journal: RepairJournal };

export const exists = (path: string) =>
  stat(path).then(() => true, () => false);

export interface RepairSite {
  readonly kind: "staging" | "copy";
  /** run() 起始写入的工作状态。 */
  readonly workingState: "installing" | "updating";
  workspacePath(roots: SiteRoots, appId: string, runId: string): string;
  trashPath(roots: SiteRoots, appId: string, runId: string): string | undefined;
  /** 重建修复现场：staging=清空后 clone；copy=停运行时 + 复制后记录 S1 基线。 */
  prepare(hooks: SiteHooks, context: SiteContext): Promise<void>;
  /** 原子交换：staging=单 rename；copy=S2 校验 + trash 两段 rename，内层失败自动复位。 */
  swap(context: SiteContext): Promise<void>;
  /** swapping 阶段崩溃现场完全矩阵；未知组合恒 locked，fail-closed。 */
  classifySwap(presence: SwapPresence): SwapDisposition;
  /** rollback 处置：copy=必要时 trash→dir 复位后清 workspace；staging=清 workspace。 */
  rollback(context: SiteContext): Promise<void>;
  /** committed 收尾：copy=清 trash；staging=空操作。 */
  cleanupCommitted(journal: RepairJournal): Promise<void>;
  /** fail-closed 收割后的记录归置；snapshot 为 run 起始记录，保留原始失败阶段。 */
  failedPatch(current: AppRecord, snapshot: AppRecord, error: Error): AppRecord;
}

// ============================================================
// staging：安装失败后的干净重装，正式目录本就无效，无需备份
// ============================================================

export const stagingSite: RepairSite = {
  kind: "staging",
  workingState: "installing",
  workspacePath: (roots, appId) => join(roots.appsRoot, ".staging", appId),
  trashPath: () => undefined,
  async prepare(hooks, { journal }) {
    await rm(journal.workspace, { recursive: true, force: true });
    await mkdir(journal.workspace, { recursive: true, mode: 0o700 });
    await hooks.clone();
  },
  async swap({ record, journal }) {
    await rename(journal.workspace, record.dir);
  },
  classifySwap(presence) {
    if (!presence.dir && presence.workspace) return "rollback";
    if (presence.dir && !presence.workspace) return "forward";
    return "locked";
  },
  async rollback({ journal }) {
    await rm(journal.workspace, { recursive: true, force: true });
  },
  async cleanupCommitted() {
    // staging 没有 trash，正式目录即最终产物。
  },
  failedPatch(current, snapshot, error) {
    return {
      ...current,
      state: "install-failed",
      lastError: {
        phase: snapshot.lastError?.phase ?? "install",
        message: `Agent 修复失败：${error.message}`,
      },
      manifest: null,
    };
  },
};

// ============================================================
// copy：就绪 App 的原地更新，S1/S2 两次快照守护正式目录
// ============================================================

export const copySite: RepairSite = {
  kind: "copy",
  workingState: "updating",
  workspacePath: (roots, appId, runId) =>
    join(roots.userData, "repair-workspaces", `${appId}-${runId}`),
  trashPath: (roots, appId, runId) =>
    join(roots.userData, "repair-trash", `${appId}-${runId}`),
  /* 只在复制之后取一次基线：S1 与提交前的 S2 一比，就已经证明了「正式目录
     自复制完成起没被动过」。复制之前再取一张 S0，多走一整棵树的 lstat，
     换来的只是「复制途中变过没有」——而那件事 S1≠S2 一样会挡下来。 */
  async prepare(hooks, { record, journal }) {
    await hooks.stopRuntime();
    await rm(journal.workspace, { recursive: true, force: true });
    await mkdir(dirname(journal.workspace), { recursive: true, mode: 0o700 });
    await cp(record.dir, journal.workspace, {
      recursive: true,
      preserveTimestamps: true,
    });
    journal.s1TreeSha256 = await snapshotTree(record.dir);
  },
  async swap({ record, journal }) {
    const s2 = await snapshotTree(record.dir);
    assertSameTree(journal.s1TreeSha256!, s2, "提交前正式目录发生变化");
    await mkdir(dirname(journal.trash!), { recursive: true, mode: 0o700 });
    await rm(journal.trash!, { recursive: true, force: true });
    await rename(record.dir, journal.trash!);
    try {
      await rename(journal.workspace, record.dir);
    } catch (cause) {
      await rename(journal.trash!, record.dir);
      throw cause;
    }
  },
  classifySwap(presence) {
    if (presence.dir && presence.workspace && !presence.trash) return "rollback";
    if (!presence.dir && presence.workspace && presence.trash) return "rollback";
    if (presence.dir && !presence.workspace && presence.trash) return "forward";
    return "locked";
  },
  async rollback({ record, journal }) {
    if (journal.trash && !(await exists(record.dir)) && (await exists(journal.trash))) {
      await rename(journal.trash, record.dir);
    }
    await rm(journal.workspace, { recursive: true, force: true });
  },
  async cleanupCommitted(journal) {
    if (journal.trash) await rm(journal.trash, { recursive: true, force: true });
  },
  failedPatch(current, _snapshot, error) {
    return {
      ...current,
      state: "update-failed",
      lastError: {
        phase: "update",
        message: `Agent 修复失败：${error.message}`,
      },
    };
  },
};

export const repairSiteFor = (kind: RepairJournal["site"]): RepairSite =>
  kind === "staging" ? stagingSite : copySite;
