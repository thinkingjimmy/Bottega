/**
 * [INPUT]: Depends on shared history-import IPC and preload `window.historyImport`
 * [OUTPUT]: Provides snapshot, Project actions, request-id/AbortSignal paged and full-index transcripts, adoption, presentation, and Memory client calls
 * [POS]: The renderer platform boundary for external history
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
function historyRequest<T>(
  signal: AbortSignal | undefined,
  invoke: (api: HistoryImportBridgeApi, requestId: string) => Promise<T>
) {
  const requestId = crypto.randomUUID();
  const api = bridge();
  const abortError = () =>
    signal?.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error("History transcript request aborted"), {
          name: "AbortError",
        });
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  const request = invoke(api, requestId);
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      api.cancelTranscript(requestId);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    request.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export const historyTranscript = (
  opaqueId: string,
  cursor?: string,
  signal?: AbortSignal
) => historyRequest(signal, (api, requestId) =>
  api.transcript({ opaqueId, cursor, requestId })
);
export const historyTranscriptIndex = (
  opaqueId: string,
  expectedHistoryRevision: string,
  signal?: AbortSignal
) => historyRequest(signal, (api, requestId) =>
  api.transcriptIndex({ opaqueId, expectedHistoryRevision, requestId })
);
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
