/**
 * [INPUT]: Depends on shared/history-import-ipc and preload exposure window.historyImport
 * [OUTPUT]: Provides a snapshot of history, Project prepare/commit, refresh, session rename/archives, transcribe, adopt and Memory preview/commit client
 * [POS]: The platform boundaries of lib/history; The components do not read directly to the renderer Electron bridge
 */

import type {
  HistoryImportBridgeApi,
  HistoryImportEvent,
  HistoryImportSnapshot,
} from "../../../shared/history-import-ipc";

declare global {
  interface Window {
    historyImport?: HistoryImportBridgeApi;
  }
}

const empty: HistoryImportSnapshot = {
  revision: 0,
  entries: [],
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
export const prepareHistoryProject = () => bridge().prepareProject();
export const countHistoryProject = (token: string) => bridge().countProject(token);
export const commitHistoryProject = (
  input: Parameters<HistoryImportBridgeApi["commitProject"]>[0]
) => bridge().commitProject(input);
export const setHistoryProjectEnabled = (projectId: string, enabled: boolean) =>
  bridge().setProjectEnabled(projectId, enabled);
export const refreshHistoryProject = (projectId: string) =>
  bridge().refreshProject(projectId);
export const renameHistorySession = (opaqueId: string, title: string) =>
  bridge().renameSession(opaqueId, title);
export const setHistorySessionArchived = (opaqueId: string, archived: boolean) =>
  bridge().setSessionArchived(opaqueId, archived);
export const historyTranscript = (opaqueId: string, cursor?: string) =>
  bridge().transcript(opaqueId, cursor);
export const adoptHistory = (input: Parameters<HistoryImportBridgeApi["adopt"]>[0]) =>
  bridge().adopt(input);
export const historyAdoptionPrefix = (chatId: string) => bridge().adoptionPrefix(chatId);
export const historyMemoryEligibility = (
  input: Parameters<HistoryImportBridgeApi["memoryEligibility"]>[0]
) => bridge().memoryEligibility(input);
export const previewHistoryMemory = (input: Parameters<HistoryImportBridgeApi["memoryPreview"]>[0]) =>
  bridge().memoryPreview(input);
export const commitHistoryMemory = (snapshotId: string, digest: string) =>
  bridge().memoryCommit(snapshotId, digest);
export const onHistoryEvent = (callback: (event: HistoryImportEvent) => void) =>
  window.historyImport?.onEvent(callback) ?? (() => undefined);
