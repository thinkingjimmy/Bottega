/**
 * [INPUT]: Depends on shared history-import IPC and preload `window.historyImport`
 * [OUTPUT]: Provides canonical-route snapshots, explicit Project Add/history import, adoption, and Memory client calls
 * [POS]: The renderer platform boundary for external history
 */

import type {
  HistoryImportBridgeApi,
  HistoryImportEvent,
  HistoryImportSnapshot,
} from "../../../shared/ipc/content/history-import-ipc";

declare global {
  interface Window {
    historyImport?: HistoryImportBridgeApi;
  }
}

const empty: HistoryImportSnapshot = {
  revision: 0,
  entries: [],
  canonicalRoutes: {},
  projects: [],
  memoryDelivering: false,
  warning: null,
};

const bridge = () => {
  if (!window.historyImport) throw new Error("当前环境不支持外源历史导入");
  return window.historyImport;
};

export const historySnapshot = () =>
  window.historyImport?.snapshot() ?? Promise.resolve(empty);
export const prepareHistoryProject = (sourceKinds: Parameters<HistoryImportBridgeApi["prepareProject"]>[0]) => bridge().prepareProject(sourceKinds);
export const countHistoryProject = (token: string) => bridge().countProject(token);
export const commitHistoryProject = (
  input: Parameters<HistoryImportBridgeApi["commitProject"]>[0]
) => bridge().commitProject(input);
export const prepareProjectHistoryImport = (input: Parameters<HistoryImportBridgeApi["prepareImport"]>[0]) =>
  bridge().prepareImport(input);
export const importProjectHistory = (
  input: Parameters<HistoryImportBridgeApi["importProject"]>[0]
) => bridge().importProject(input);
export const adoptHistory = (input: Parameters<HistoryImportBridgeApi["adopt"]>[0]) =>
  bridge().adopt(input);
export const historyMemoryEligibility = (
  input: Parameters<HistoryImportBridgeApi["memoryEligibility"]>[0]
) => bridge().memoryEligibility(input);
export const previewHistoryMemory = (input: Parameters<HistoryImportBridgeApi["memoryPreview"]>[0]) =>
  bridge().memoryPreview(input);
export const commitHistoryMemory = (snapshotId: string, digest: string) =>
  bridge().memoryCommit(snapshotId, digest);
/** Every Memory preview surface calls this when its preview leaves the screen, answered or not. */
export const discardHistoryMemory = (snapshotId: string) =>
  void bridge().memoryDiscard(snapshotId).catch(() => undefined);
export const onHistoryEvent = (callback: (event: HistoryImportEvent) => void) =>
  window.historyImport?.onEvent(callback) ?? (() => undefined);
