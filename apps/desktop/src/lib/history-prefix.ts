/**
 * [INPUT]: Depends on the history adoption wire DTO and foreign transcript blocks
 * [OUTPUT]: Provides HistoryPrefixProjection, adopted projection, and strict route-generation-to-canonical-anchor resolution
 * [POS]: The canonical immutable-prefix contract shared by Transcript, Outline, Find and deep-link routing
 */

import type {
  ForeignHistoryBlock,
  HistoryAdoptionPrefix,
} from "../../shared/history-import-ipc";
import { foreignHistoryAnchor } from "../../shared/foreign-history-grouping";

export type HistoryPrefixSource =
  | Readonly<{
      kind: "foreign";
      contentGenerationKey: string;
      routeGenerationKey: string;
    }>
  | Readonly<{
      kind: "adopted";
      contentGenerationKey: string;
      routeGenerationKey: string;
    }>;

export type HistoryPrefixProjection = Readonly<{
  source: HistoryPrefixSource;
  loadState:
    | Readonly<{ kind: "idle" }>
    | Readonly<{ kind: "loading" }>
    | Readonly<{ kind: "ready" }>
    | Readonly<{ kind: "error"; message: string; retry: () => void }>;
  title: string;
  blocks: ForeignHistoryBlock[];
  nextCursor: string | null;
  quality: Readonly<{
    incompleteTail: boolean | "unknown";
    sourceStatus: "match" | "changed" | "missing";
  }>;
  capabilities: Readonly<{ canResume: boolean }>;
}>;

export function projectAdoptedHistoryPrefix(
  prefix: HistoryAdoptionPrefix
): HistoryPrefixProjection {
  return {
    source: {
      kind: "adopted",
      contentGenerationKey: prefix.contentGenerationKey,
      routeGenerationKey: prefix.routeGenerationKey,
    },
    loadState: { kind: "ready" },
    title: prefix.title,
    blocks: prefix.blocks,
    nextCursor: null,
    quality: {
      incompleteTail: prefix.incompleteTail,
      sourceStatus: prefix.sourceStatus,
    },
    capabilities: { canResume: false },
  };
}

/** `?b=` wire = routeGenerationKey:rowKey；只认当前冻结路由代际。 */
export function historyRouteAnchor(
  prefix: HistoryPrefixProjection,
  target: string
): string | null {
  const split = target.indexOf(":");
  if (split <= 0 || split === target.length - 1) return null;
  if (target.slice(0, split) !== prefix.source.routeGenerationKey) return null;
  return foreignHistoryAnchor(
    prefix.source.contentGenerationKey,
    target.slice(split + 1)
  );
}
