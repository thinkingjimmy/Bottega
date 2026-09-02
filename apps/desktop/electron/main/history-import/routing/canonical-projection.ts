/**
 * [INPUT]: Depends on the durable history-index snapshot and caller-owned visibility/liveness/presentation predicates
 * [OUTPUT]: Provides mutually exclusive unsynchronized History summaries and canonical Chat/generation redirect pointers
 * [POS]: Pure routing projection beneath HistoryImportService; canonical SQLite Chats never re-enter the legacy History lane
 */

import type { ForeignHistorySummary, HistoryImportSnapshot } from "../../../../shared/history-import-ipc";
import type { AdapterEntry } from "../adapter";
import type { IndexState, StoredCanonicalRoute, StoredHistoryProject } from "../index-store";

export function canonicalHistoryProjection(input: {
  state: IndexState;
  projectVisible(project: StoredHistoryProject): boolean;
  entryVisible(entry: AdapterEntry): boolean;
  /* 指向已删除 Chat 的路由不是路由，是断链：投影里当它不存在，条目于是
     重新回到未路由那一侧，下一次同步照常把 Chat 重建出来。 */
  routeLive(route: StoredCanonicalRoute): boolean;
  present(entry: AdapterEntry): ForeignHistorySummary;
}): Pick<HistoryImportSnapshot, "entries" | "canonicalRoutes"> {
  const projects = Object.values(input.state.projects).filter(input.projectVisible);
  const liveRoute = (entry: AdapterEntry) => {
    const route = input.state.canonicalRoutes[entry.opaqueId];
    return route && input.routeLive(route) ? route : undefined;
  };
  return {
    entries: projects.flatMap((project) => project.entries
      .filter((entry) => !liveRoute(entry) && input.entryVisible(entry))
      .map(input.present)),
    canonicalRoutes: Object.fromEntries(projects.flatMap((project) =>
      project.entries.flatMap((entry) => {
        const route = liveRoute(entry);
        return route ? [[entry.opaqueId, { ...route, summary: input.present(entry) }] as const] : [];
      }))),
  };
}
