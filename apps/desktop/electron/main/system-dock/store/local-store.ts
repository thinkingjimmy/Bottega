/**
 * [INPUT]: Depends on the DurableJson persistence primitive and the shared DockLocalState schema.
 * [OUTPUT]: Provides DockLocalStore: the profile-local, never-synced Dock preferences and replacement intent with serialized atomic updates and change events.
 * [POS]: system-dock/store machine facts (INV-02/06); a different profile never inherits consent, intent, or bindings because each profile has its own userData.
 */

import { join } from "node:path";
import { DurableJson } from "../../persistence/durable-json";
import { DEFAULT_DOCK_LOCAL_STATE, dockLocalStateSchema, type DockLocalState } from "../../../../shared/system-dock/local-state";

export class DockLocalStore {
  private readonly file: DurableJson<DockLocalState>;
  private readonly listeners = new Set<(state: DockLocalState) => void>();
  constructor(directory: string) { this.file = new DurableJson(join(directory, "system-dock-local.json"), dockLocalStateSchema, () => structuredClone(DEFAULT_DOCK_LOCAL_STATE)); }
  async initialize() { await this.file.initialize(); }
  get(): DockLocalState { return this.file.snapshot(); }
  onChanged(listener: (state: DockLocalState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async update(change: (state: DockLocalState) => DockLocalState): Promise<DockLocalState> {
    const state = await this.file.mutate((current) => { const next = dockLocalStateSchema.parse(change(structuredClone(current))); Object.assign(current, next); return next; });
    for (const listener of [...this.listeners]) { try { listener(state); } catch (cause) { console.warn("[system-dock] local listener failed", cause); } }
    return state;
  }
  async close() { await this.file.closeAndFlush(); }
}
