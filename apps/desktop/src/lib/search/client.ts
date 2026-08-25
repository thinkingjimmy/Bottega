/**
 * [INPUT]: Depends on shared/search-ipc and preload window.globalSearch
 * [OUTPUT]: Provides start/pull/cancel for global search clients
 * [POS]: The Electron boundary of lib/search; Components do not have direct access to preload bridge
 */

import type { SearchJobBridgeApi } from "../../../shared/search-ipc";

declare global { interface Window { globalSearch?: SearchJobBridgeApi } }

const bridge = () => {
  if (!window.globalSearch) throw new Error("当前环境不支持全局搜索");
  return window.globalSearch;
};

export const startGlobalSearch = (query: string) => bridge().start({ query });
export const pullGlobalSearch = (input: Parameters<SearchJobBridgeApi["pull"]>[0]) => bridge().pull(input);
export const cancelGlobalSearch = (jobId: string) => bridge().cancel(jobId);
