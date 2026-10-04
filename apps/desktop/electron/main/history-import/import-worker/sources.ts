/**
 * [INPUT]: Depends on the fence table's state-root resolvers (`stateRoots` for Claude, `codexHome`, `resolveKimiCodeHome`, `opencodeDataDirectory`), the adapter port and parser version, and the import-worker client's answered calls.
 * [OUTPUT]: Provides historySourceRoots(env, userHome) (each source's state root, CODEX_HOME / KIMI_CODE_HOME / XDG honoured, G12) and workerHistoryAdapters(client, roots): the four HistoryAdapters main uses, whose scan, warm-up and complete parse run on the import worker.
 * [POS]: Main's side of TASK-11 D10: history import reads other Agents' files only on the import worker, never on main's thread, and only under the roots the fence table resolves. Nothing here imports a concrete adapter (that is the worker's), which __tests__/history-import-off-main.test.ts pins.
 */
import { HISTORY_SOURCE_KINDS } from "../../../../shared/ipc/content/history-import-ipc";
import { codexHome, stateRoots } from "../../backends/sandbox/fences";
import { resolveKimiCodeHome } from "../../providers/kimi/home";
import { opencodeDataDirectory } from "../../providers/opencode/home";
import { HISTORY_PARSER_VERSION, type AdapterEntry, type AdapterScan, type HistoryAdapter, type ParsedHistory, type ScanDepth } from "../adapters/adapter";
import type { HistoryImportWorkerClient } from "./client";
import type { HistorySourceRoots } from "./protocol";

export type { HistorySourceRoots } from "./protocol";

/** The same resolvers the fence table uses for these Agents' state, so an import reads exactly where the Agent keeps its sessions. */
export function historySourceRoots(env: NodeJS.ProcessEnv, userHome: string): HistorySourceRoots {
  return {
    claude: stateRoots("claude", { env, userHome })[0]!,
    codex: codexHome(env, userHome),
    kimi: resolveKimiCodeHome(env, userHome),
    opencode: opencodeDataDirectory(env, userHome),
  };
}

export function workerHistoryAdapters(client: Pick<HistoryImportWorkerClient, "call">, roots: HistorySourceRoots): HistoryAdapter[] {
  return HISTORY_SOURCE_KINDS.map((sourceKind): HistoryAdapter => ({
    sourceKind,
    parserVersion: HISTORY_PARSER_VERSION,
    scanProject: (root: string, depth?: ScanDepth) => client.call<AdapterScan>({ roots, sourceKind, op: "scan", root, ...(depth ? { depth } : {}) }),
    warm: () => client.call<void>({ roots, sourceKind, op: "warm" }),
    parse: (entry: AdapterEntry, signal?: AbortSignal) => client.call<ParsedHistory>({ roots, sourceKind, op: "parse", entry }, signal),
  }));
}
