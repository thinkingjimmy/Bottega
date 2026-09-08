/**
 * [INPUT]: Depends on shared Archive IPC and preload window.archive
 * [OUTPUT]: Provides the renderer's sole Archive client: list/archive/restore/preview/execute-purge calls and event subscription, with mutations rejected when the preload bridge is missing
 * [POS]: lib's IPC boundary for Archive; components must never touch the IPC channel directly
 */

import type {
  ArchiveBridgeApi,
  ArchivePurgeMode,
  ArchiveSnapshot,
  ArchiveTarget,
} from "../../shared/archive-ipc";

declare global {
  interface Window {
    archive?: ArchiveBridgeApi;
  }
}

const empty = (): ArchiveSnapshot => ({ entities: [], revision: 0 });

// ─── 写操作缺桥必须失败：静默假成功会让用户以为已归档 ───
const requireBridge = () => {
  if (!window.archive) throw new Error("桌面环境不可用，归档操作未执行");
  return window.archive;
};

export const listArchive = () =>
  window.archive?.list() ?? Promise.resolve(empty());

export const archiveTargets = (targets: ArchiveTarget[]) =>
  requireBridge().archive(targets);

export const restoreArchiveTargets = (targets: ArchiveTarget[]) =>
  requireBridge().restore(targets);

export const previewPurge = (targets: ArchiveTarget[]) =>
  window.archive?.previewPurge(targets) ??
  Promise.resolve({
    deletePaths: [],
    retainedExternalBindings: [],
    rootBaseCount: 0,
    blockedReasons: ["浏览器演示模式不执行删除"],
    memory: null,
    executionToken: "",
  });

export const executePurge = (
  executionToken: string,
  targets: ArchiveTarget[],
  mode: ArchivePurgeMode
) => requireBridge().executePurge(executionToken, targets, mode);

export const onArchiveEvent = (
  callback: Parameters<ArchiveBridgeApi["onEvent"]>[0]
) => window.archive?.onEvent(callback) ?? (() => {});
