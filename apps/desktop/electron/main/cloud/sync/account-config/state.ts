/**
 * [INPUT]: Depends on the shared Dock layout model and its single merge algorithm, the account-config record, the Dock store record and the scope reset in ./cleanup.
 * [OUTPUT]: Provides the synchronous record transitions the coordinator runs inside `DockConfigStore.updateSync`: scope entry/sealing, remote integration (adopt, fast-forward, three-way merge, first-sync/three-way/unsupported conflicts), candidate capture/settlement and user conflict resolution.
 * [POS]: cloud/sync/account-config pure state machine; no network, crypto or timers, so every transition is atomic with the store write that persists it (INV-15).
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { DOCK_LAYOUT_CONFIG_ID, type EncryptedAccountConfig } from "@ai-chat/cloud-protocol/account-config/model";
import type { DockLayout } from "../../../../../shared/system-dock/layout";
import { mergeLayouts, unionPreview, type MergeConflict } from "../../../../../shared/system-dock/merge";
import type { ConflictChoice } from "../../../../../shared/system-dock/ipc";
import type { DockCandidate, DockConfigRecord } from "../../../system-dock/store/config-store";
import { detachSync } from "./cleanup";

export const SEALED_LIMIT = 8;
export const sameLayout = (a: DockLayout | null, b: DockLayout | null) => canonicalJson(a) === canonicalJson(b);
/** What the server currently holds, as far as this client may interpret it. */
export type RemoteView =
  | { kind: "absent"; revision: 0 }
  | { kind: "layout"; revision: number; layout: DockLayout }
  | { kind: "unsupported"; revision: number; bytes: string };
/* Re-detecting the same conflict keeps its original time, so a re-evaluation is not a new event. */
const since = (record: DockConfigRecord, kind: "first-sync" | "three-way" | "unsupported", revision: number, now: number) =>
  record.sync.conflict?.kind === kind && record.sync.conflict.remoteRevision === revision ? record.sync.conflict.detectedAt : now;
export type Integration = "absent" | "unchanged" | "adopted" | "equal" | "fast-forward" | "merged" | "conflict" | "unsupported";

/** Replaces the working layout from sync; the local revision moves so a stale preview confirmation is refused (3.1). */
function adopt(record: DockConfigRecord, layout: DockLayout) {
  if (sameLayout(record.layout, layout)) return;
  record.layout = structuredClone(layout); record.localRevision += 1;
}
function acknowledge(record: DockConfigRecord, remote: DockLayout, revision: number) {
  record.sync.base = structuredClone(remote); record.sync.acknowledgedRevision = revision;
  record.sync.conflict = null; record.sync.unsupportedRemote = null;
  record.sync.pending = !sameLayout(record.layout, remote);
}
/**
 * signOut / leaving a scope: the base and working snapshot become a LocalContinuation; the candidate loses its
 * upload right and is never forwarded to another account (INV-16). The working layout stays usable.
 */
export function sealScope(record: DockConfigRecord, now: number) {
  const scopeKey = record.sync.scopeKey;
  if (!scopeKey) return;
  const kept = record.sync.sealed.filter(entry => entry.sourceScope !== scopeKey);
  if (record.sync.base) kept.push({ sourceScope: scopeKey, baseRevision: record.sync.acknowledgedRevision, baseSnapshot: structuredClone(record.sync.base),
    localSnapshot: structuredClone(record.layout), sealedAt: now });
  record.sync.sealed = kept.slice(-SEALED_LIMIT);
  detachSync(record);
}
/** Same-account return resumes from the sealed base through the normal 4.3 flow; any other scope starts without a base. */
export function enterScope(record: DockConfigRecord, scopeKey: string, now: number) {
  if (record.sync.scopeKey === scopeKey) return false;
  sealScope(record, now);
  const sealed = record.sync.sealed.find(entry => entry.sourceScope === scopeKey);
  record.sync.sealed = record.sync.sealed.filter(entry => entry.sourceScope !== scopeKey);
  detachSync(record);
  record.sync.scopeKey = scopeKey; record.sync.configId = DOCK_LAYOUT_CONFIG_ID;
  if (sealed?.baseSnapshot) {
    record.sync.base = sealed.baseSnapshot; record.sync.acknowledgedRevision = sealed.baseRevision;
    record.sync.pending = !sameLayout(record.layout, sealed.baseSnapshot);
  }
  return true;
}
/**
 * The only reconciliation with a remote snapshot (PRD 4.3). Without a reliable base nothing is merged automatically;
 * an unknown schema or undecryptable record is kept verbatim and never written back over (INV-15).
 */
export function integrate(record: DockConfigRecord, remote: RemoteView, now: number): Integration {
  const sync = record.sync;
  if (remote.kind === "unsupported") {
    sync.unsupportedRemote = { revision: remote.revision, bytes: remote.bytes };
    sync.conflict = { kind: "unsupported", remote: null, remoteRevision: remote.revision, detectedAt: since(record, "unsupported", remote.revision, now) };
    return "unsupported";
  }
  if (remote.kind === "absent") {
    if (sync.conflict?.kind === "unsupported") { sync.conflict = null; sync.unsupportedRemote = null; }
    if (sync.acknowledgedRevision === 0 && !sync.conflict) return "unchanged";
    // The record disappeared (account data erased server-side): create again from the local layout, never from a stale base.
    sync.base = null; sync.acknowledgedRevision = 0; sync.conflict = null; sync.pending = record.layout.initialized;
    return "absent";
  }
  if (sync.unsupportedRemote && sync.unsupportedRemote.revision !== remote.revision) sync.unsupportedRemote = null;
  if (sync.conflict?.kind === "unsupported") sync.conflict = null;
  if (!sync.conflict && sync.base && remote.revision === sync.acknowledgedRevision) return "unchanged";
  if (!sync.base) {
    if (!record.layout.initialized) { adopt(record, remote.layout); acknowledge(record, remote.layout, remote.revision); return "adopted"; }
    if (sameLayout(record.layout, remote.layout)) { acknowledge(record, remote.layout, remote.revision); return "equal"; }
    sync.conflict = { kind: "first-sync", remote: structuredClone(remote.layout), remoteRevision: remote.revision, detectedAt: since(record, "first-sync", remote.revision, now) };
    return "conflict";
  }
  if (!sync.pending && sameLayout(record.layout, sync.base)) {
    adopt(record, remote.layout); acknowledge(record, remote.layout, remote.revision); return "fast-forward";
  }
  const result = mergeLayouts(sync.base, record.layout, remote.layout);
  if (result.status === "merged") { adopt(record, result.layout); acknowledge(record, remote.layout, remote.revision); return "merged"; }
  sync.conflict = { kind: "three-way", remote: structuredClone(remote.layout), remoteRevision: remote.revision, detectedAt: since(record, "three-way", remote.revision, now) };
  return "conflict";
}
/** Bounded CAS races end here: the user sees a non-modal conflict against the latest remote instead of an endless retry. */
export function surfaceRace(record: DockConfigRecord, remote: RemoteView, now: number) {
  if (remote.kind !== "layout") return integrate(record, remote, now);
  record.sync.conflict = { kind: record.sync.base ? "three-way" : "first-sync", remote: structuredClone(remote.layout), remoteRevision: remote.revision, detectedAt: now };
  return "conflict" as const;
}
export function uploadable(record: DockConfigRecord, scopeKey: string) {
  const sync = record.sync;
  return sync.scopeKey === scopeKey && sync.pending && !sync.candidate && !sync.conflict && !sync.unsupportedRemote && (record.layout.initialized || sync.base !== null);
}
/** Persisted before sending: the operation, expected revision, exact snapshot and exact bytes never change afterwards (INV-15). */
export function captureCandidate(record: DockConfigRecord, sealed: EncryptedAccountConfig, snapshot: DockLayout, localRevision: number): DockCandidate {
  const candidate: DockCandidate = { operationId: sealed.operationId, expectedRevision: sealed.revision - 1, snapshot: structuredClone(snapshot),
    ciphertext: JSON.stringify(sealed), ciphertextHash: sealed.packet.ciphertextHash, localRevision, state: "prepared" };
  record.sync.candidate = candidate;
  return candidate;
}
/** Server-confirmed: edits made while the candidate was in flight stay in the working layout and keep `pending`. */
export function settleApplied(record: DockConfigRecord, candidate: DockCandidate, revision: number) {
  record.sync.base = structuredClone(candidate.snapshot); record.sync.acknowledgedRevision = revision; record.sync.candidate = null;
  record.sync.conflict = null; record.sync.unsupportedRemote = null;
  record.sync.pending = record.localRevision !== candidate.localRevision && !sameLayout(record.layout, candidate.snapshot);
}
export function conflictList(record: DockConfigRecord): MergeConflict[] {
  const conflict = record.sync.conflict;
  if (conflict?.kind !== "three-way" || !conflict.remote || !record.sync.base) return [];
  const result = mergeLayouts(record.sync.base, record.layout, conflict.remote);
  return result.status === "conflict" ? result.conflicts : [];
}
/**
 * The user's non-modal decision. `merge` is the union preview without a base, or the three-way result with explicit
 * choices; `remote` takes the remote layout; `local` replaces the remote by CAS on the remote revision. An unknown
 * remote format is never overwritten.
 */
export function resolveConflict(record: DockConfigRecord, choice: ConflictChoice) {
  const conflict = record.sync.conflict;
  if (!conflict) throw new Error("ACCOUNT_CONFIG_NO_CONFLICT");
  if (conflict.kind === "unsupported" || !conflict.remote) throw new Error("ACCOUNT_CONFIG_REMOTE_UNSUPPORTED");
  const remote = conflict.remote;
  let next = record.layout;
  if (choice.strategy === "remote") next = remote;
  else if (choice.strategy === "merge") {
    if (conflict.kind === "first-sync" || !record.sync.base) next = unionPreview(record.layout, remote);
    else {
      const result = mergeLayouts(record.sync.base, record.layout, remote);
      next = result.status === "merged" ? result.layout : result.resolve(choice.choices);
    }
  }
  adopt(record, next);
  acknowledge(record, remote, conflict.remoteRevision);
}
