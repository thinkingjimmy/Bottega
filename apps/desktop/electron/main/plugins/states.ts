/**
 * [INPUT]: DurableJson, strict plugin-state schema and generation identity.
 * [OUTPUT]: Atomic built-in on/off state and Artifact generation in plugin-states.json; absent switch entries remain enabled.
 * [POS]: plugins' durable truth for built-ins; installed host packages keep theirs in the Extension Registry, native plugins in their Agent's CLI.
 */
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../persistence/durable-json";
import { randomUUID } from "node:crypto";

const fileSchema = z.object({ schemaVersion: z.literal(1), artifactGeneration: z.string().max(128).default("initial"),
  off: z.record(z.string().min(1).max(64), z.object({ turnedOffAt: z.number().int().min(0) }).strict()) }).strict();
type StateFile = z.infer<typeof fileSchema>;

export class PluginStateStore {
  private readonly file: DurableJson<StateFile>;
  constructor(userData: string) {
    this.file = new DurableJson(join(userData, "plugin-states.json"), fileSchema, () => ({ schemaVersion: 1, off: {}, artifactGeneration: "initial" }));
  }
  initialize() { return this.file.initialize(); }
  closeAndFlush() { return this.file.closeAndFlush(); }
  turnedOffAt(pluginId: string): number | null { return this.file.read(state => state.off[pluginId]?.turnedOffAt ?? null); }
  offIds(): string[] { return this.file.read(state => Object.keys(state.off)); }
  generation() { return this.file.read(state => state.artifactGeneration); }
  async set(pluginId: string, enabled: boolean, now: number) {
    await this.file.mutate(state => {
      if (pluginId === "artifact" && enabled === Boolean(state.off[pluginId])) state.artifactGeneration = randomUUID();
      if (enabled) delete state.off[pluginId];
      else state.off[pluginId] ??= { turnedOffAt: now };
    });
  }
}
