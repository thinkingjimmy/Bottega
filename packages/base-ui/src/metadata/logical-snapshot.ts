/**
 * [INPUT]: Depends on canonical Base snapshots with local persistence generations.
 * [OUTPUT]: Provides the logical content compared during first-sync admission.
 * [POS]: Local file generations and local revision never become a cloud synchronization baseline.
 */
import type { BaseSnapshot } from "../model/bases-ipc";
export function logicalBaseSnapshot(snapshot: BaseSnapshot) {
  const { revision: _revision, rowsGeneration: _rows, galleryGeneration: _gallery, historyGeneration: _history,
    syncGeneration: _sync, syncHash: _hash, ...meta } = snapshot.meta;
  return { meta, rows: snapshot.rows };
}
