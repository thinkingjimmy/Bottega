/**
 * [INPUT]: Depends on adapter identities/fingerprints and shared history source keys
 * [OUTPUT]: Provides deterministic file-state, ownership, revision, claim, and public-summary projections
 * [POS]: Pure history-index policy shared by detection, publication, routing, and tests
 */

import {
  HISTORY_SOURCE_KINDS,
  sessionAliases,
  type HistoryFileFingerprint,
  type HistorySourceKind,
} from "../../../../shared/history-import-ipc";
import { isWithin, sameFingerprint, type AdapterEntry, type AdapterScan } from "../adapter";

export function historyFileState(previous: HistoryFileFingerprint | undefined, next: HistoryFileFingerprint | undefined, movedToArchive = false) {
  if (!previous) return next ? "new" : "unchanged";
  if (!next) return "delete";
  if (movedToArchive) return "archive";
  if (previous.device !== next.device || previous.inode !== next.inode) return "replace";
  if (next.size < previous.size) return "truncate";
  if (next.size > previous.size) return "append";
  return sameFingerprint(previous, next) ? "unchanged" : "replace";
}

export function historiesChanged(previous: AdapterEntry[], next: AdapterEntry[]) {
  const before = new Map(previous.map((entry) => [entry.sourcePath, entry.fingerprint]));
  const after = new Map(next.map((entry) => [entry.sourcePath, entry.fingerprint]));
  return before.size !== after.size || [...after].some(
    ([path, fingerprint]) => historyFileState(before.get(path), fingerprint) !== "unchanged"
  );
}

export function deepestOwner(cwd: string, projects: Array<{ id: string; dir: string }>) {
  return projects.filter((project) => project.dir && isWithin(project.dir, cwd))
    .sort((left, right) => right.dir.length - left.dir.length || left.id.localeCompare(right.id))[0];
}

export function sourceRevisions(scans: AdapterScan[]): Record<HistorySourceKind, string> {
  return Object.fromEntries(HISTORY_SOURCE_KINDS.map((kind) =>
    [kind, scans.find((scan) => scan.sourceKind === kind)?.sourceRevision ?? "missing"]
  )) as Record<HistorySourceKind, string>;
}

export function aliasesClaimed(entry: AdapterEntry, claimed: ReadonlySet<string>) {
  return [...sessionAliases(entry.key)].some((alias) => claimed.has(`${entry.sourceKind}:${alias}`));
}

export function publicEntry(entry: AdapterEntry) {
  const { sourcePath: _path, fingerprint: _fingerprint, sourceIncarnation: _incarnation, ...summary } = entry;
  return summary;
}
