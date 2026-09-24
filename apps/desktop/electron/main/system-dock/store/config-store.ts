/**
 * [INPUT]: Depends on zod, the DurableJson persistence primitive, and the shared DockLayout model.
 * [OUTPUT]: Provides DockConfigStore: the single main-owned record holding the working layout, its local edit revision, and the account-config sync state (durable base, pending flag, immutable in-flight candidate, unresolved conflict, sealed continuations); atomic serialized mutations and change events.
 * [POS]: system-dock/store truth for everything portable; DockService edits the working layout, AccountConfigSyncCoordinator edits only `sync` and adopts merged snapshots through `adopt`. Renderer localStorage is never truth (4.1).
 */

import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import { dockLayoutSchema, UNINITIALIZED_LAYOUT, type DockLayout } from "../../../../shared/system-dock/layout";

const candidateSchema = z.object({ operationId: z.string().min(8).max(64), expectedRevision: z.number().int().nonnegative(), snapshot: dockLayoutSchema,
  /** Exact ciphertext bytes (base64) and hash so an unknown outcome is re-sent unchanged or looked up by receipt (INV-15). */
  ciphertext: z.string().max(2 * 1024 * 1024).nullable(), ciphertextHash: z.string().max(128).nullable(), localRevision: z.number().int().nonnegative(),
  state: z.enum(["prepared", "sent", "unknown"]) }).strict();
const conflictSchema = z.object({ kind: z.enum(["first-sync", "three-way", "unsupported"]), remote: dockLayoutSchema.nullable(),
  remoteRevision: z.number().int().nonnegative(), detectedAt: z.number().int().nonnegative() }).strict();
const continuationSchema = z.object({ sourceScope: z.string().min(1).max(256), baseRevision: z.number().int().nonnegative(), baseSnapshot: dockLayoutSchema.nullable(),
  localSnapshot: dockLayoutSchema, sealedAt: z.number().int().nonnegative() }).strict();
export const dockSyncStateSchema = z.object({
  scopeKey: z.string().min(1).max(256).nullable(),
  configId: z.string().min(1).max(128).nullable(),
  acknowledgedRevision: z.number().int().nonnegative(),
  base: dockLayoutSchema.nullable(),
  pending: z.boolean(),
  candidate: candidateSchema.nullable(),
  conflict: conflictSchema.nullable(),
  /** Remote bytes of an unsupported schema are kept verbatim and never written back (INV-15/17). */
  unsupportedRemote: z.object({ revision: z.number().int().nonnegative(), bytes: z.string().max(2 * 1024 * 1024) }).strict().nullable(),
  sealed: z.array(continuationSchema).max(8),
}).strict();
export const dockConfigRecordSchema = z.object({ version: z.literal(1), layout: dockLayoutSchema, localRevision: z.number().int().nonnegative(),
  sync: dockSyncStateSchema }).strict();
export type DockSyncState = z.infer<typeof dockSyncStateSchema>;
export type DockCandidate = z.infer<typeof candidateSchema>;
export type DockConflict = z.infer<typeof conflictSchema>;
export type DockContinuation = z.infer<typeof continuationSchema>;
export type DockConfigRecord = z.infer<typeof dockConfigRecordSchema>;
export const EMPTY_SYNC_STATE: DockSyncState = { scopeKey: null, configId: null, acknowledgedRevision: 0, base: null, pending: false, candidate: null,
  conflict: null, unsupportedRemote: null, sealed: [] };
const empty = (): DockConfigRecord => ({ version: 1, layout: structuredClone(UNINITIALIZED_LAYOUT), localRevision: 0, sync: structuredClone(EMPTY_SYNC_STATE) });

export type DockConfigChange = { record: DockConfigRecord; origin: "local" | "sync" };

export class DockConfigStore {
  private readonly file: DurableJson<DockConfigRecord>;
  private readonly listeners = new Set<(change: DockConfigChange) => void>();
  constructor(directory: string) { this.file = new DurableJson(join(directory, "system-dock-config.json"), dockConfigRecordSchema, empty); }
  async initialize() { await this.file.initialize(); }
  snapshot(): DockConfigRecord { return this.file.snapshot(); }
  layout(): DockLayout { return this.file.snapshot().layout; }
  onChanged(listener: (change: DockConfigChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /**
   * A local edit: bumps the local revision and marks pending so a later candidate never
   * swallows it. `expectedRevision` lets preview flows refuse a stale confirmation (3.1).
   */
  async edit(change: (layout: DockLayout) => DockLayout, expectedRevision?: number): Promise<DockConfigRecord> {
    const record = await this.file.mutate((state) => {
      if (expectedRevision !== undefined && state.localRevision !== expectedRevision) throw new Error("DOCK_LAYOUT_REVISION_CHANGED");
      const next = dockLayoutSchema.parse(change(structuredClone(state.layout)));
      if (JSON.stringify(next) === JSON.stringify(state.layout)) return structuredClone(state);
      state.layout = next; state.localRevision += 1; state.sync.pending = true;
      return structuredClone(state);
    });
    this.emit(record, "local");
    return record;
  }
  /** Sync-only mutation of `sync`, optionally adopting a merged/remote working layout. */
  async updateSync(change: (record: DockConfigRecord) => void): Promise<DockConfigRecord> {
    const record = await this.file.mutate((state) => { change(state); return structuredClone(state); });
    this.emit(record, "sync");
    return record;
  }
  async close() { await this.file.closeAndFlush(); }
  private emit(record: DockConfigRecord, origin: DockConfigChange["origin"]) {
    for (const listener of [...this.listeners]) { try { listener({ record, origin }); } catch (cause) { console.warn("[system-dock] config listener failed", cause); } }
  }
}
