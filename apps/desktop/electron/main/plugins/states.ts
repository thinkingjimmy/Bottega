/**
 * [INPUT]: Depends on DurableJson.
 * [OUTPUT]: Provides PluginStateStore (`<userData>/plugin-states.json`): the on/off state of Bottega's built-in switchable plugins (the four Providers and Workflow), with when each was turned off. A plugin with no entry is on.
 * [POS]: plugins' durable truth for built-ins; installed host packages keep theirs in the Extension Registry, native plugins in their Agent's CLI.
 */
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../persistence/durable-json";

const fileSchema = z.object({ schemaVersion: z.literal(1),
  off: z.record(z.string().min(1).max(64), z.object({ turnedOffAt: z.number().int().min(0) }).strict()) }).strict();
type StateFile = z.infer<typeof fileSchema>;

export class PluginStateStore {
  private readonly file: DurableJson<StateFile>;
  constructor(userData: string) {
    this.file = new DurableJson(join(userData, "plugin-states.json"), fileSchema, () => ({ schemaVersion: 1, off: {} }));
  }
  initialize() { return this.file.initialize(); }
  closeAndFlush() { return this.file.closeAndFlush(); }
  turnedOffAt(pluginId: string): number | null { return this.file.read(state => state.off[pluginId]?.turnedOffAt ?? null); }
  offIds(): string[] { return this.file.read(state => Object.keys(state.off)); }
  async set(pluginId: string, enabled: boolean, now: number) {
    await this.file.mutate(state => {
      if (enabled) delete state.off[pluginId];
      else state.off[pluginId] ??= { turnedOffAt: now };
    });
  }
}
