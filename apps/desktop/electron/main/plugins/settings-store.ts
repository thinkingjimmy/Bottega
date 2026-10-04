/**
 * [INPUT]: Depends on DurableJson (0600, atomic), Node crypto/path, and the plugin settings contract (fields, values, patch, checkSettingValue).
 * [OUTPUT]: Provides PluginSettingsStore: view (defaults filled, secrets as set/unset, which ids differ from default), overrides (only the
 *           values a person changed: what may be sent), packageValues (a package's own values, secrets in clear, for settings.get), and
 *           submit (validates against the fields; a value equal to its default is removed; returns the ids that changed), plus
 *           SettingsRefusal.
 * [POS]: The store owner of appendix C.5: `<userData>/plugin-settings/<plugin>.json` keeps only changed values; secrets live apart in
 *        `plugin-settings/secrets/<plugin>.json` (0600, the same plain-file-in-userData custody as manual MCP secrets) and never leave main
 *        except to their own package. `owner: "adapter"` fields never reach this store; the catalog routes them to their owner.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { checkSettingValue, settingValueSchema, type PluginSettingsView, type SettingField, type SettingValue, type SettingsPatch }
  from "@bottega/contracts/plugins/settings";
import { DurableJson } from "../persistence/durable-json";

const fileSchema = z.object({ schemaVersion: z.literal(1), pluginId: z.string().min(1).max(160),
  values: z.record(z.string().max(48), settingValueSchema) }).strict();
type File = z.infer<typeof fileSchema>;

export class SettingsRefusal extends Error {
  constructor(readonly code: "setting-unknown" | "setting-invalid") { super(code); }
}

/* Built-in ids are safe file names; an install identity is hashed so it can never name a path. */
const fileName = (pluginId: string) => /^[a-z][a-z0-9-]{0,63}$/.test(pluginId) ? pluginId : `pkg-${createHash("sha256").update(pluginId).digest("hex").slice(0, 32)}`;
const equal = (field: SettingField, value: SettingValue) => field.type !== "secret" && field.default === value;

export class PluginSettingsStore {
  private readonly files = new Map<string, Promise<{ values: DurableJson<File>; secrets: DurableJson<File> }>>();
  constructor(private readonly userData: string) {}

  private open(pluginId: string) {
    let opened = this.files.get(pluginId);
    if (!opened) {
      const name = `${fileName(pluginId)}.json`, empty = () => ({ schemaVersion: 1 as const, pluginId, values: {} });
      const values = new DurableJson(join(this.userData, "plugin-settings", name), fileSchema, empty);
      const secrets = new DurableJson(join(this.userData, "plugin-settings", "secrets", name), fileSchema, empty);
      opened = Promise.all([values.initialize(), secrets.initialize()]).then(() => ({ values, secrets }));
      opened.catch(() => this.files.delete(pluginId));
      this.files.set(pluginId, opened);
    }
    return opened;
  }

  /** What the page shows: every field's current value (defaults filled), secrets only as set / unset. */
  async view(pluginId: string, fields: readonly SettingField[], pendingRestart: boolean): Promise<PluginSettingsView> {
    const { values, secrets } = await this.open(pluginId);
    const stored = values.read(file => file.values), hidden = secrets.read(file => file.values);
    const current: PluginSettingsView["values"] = {};
    const changed: string[] = [];
    for (const field of fields) {
      if (field.owner !== "store") continue;
      if (field.type === "secret") { current[field.id] = { secret: typeof hidden[field.id] === "string" ? "set" : "unset" }; if (hidden[field.id] !== undefined) changed.push(field.id); continue; }
      const value = stored[field.id];
      const valid = value !== undefined && checkSettingValue(field, value) === null;
      current[field.id] = valid ? value : field.default;
      if (valid && !equal(field, value)) changed.push(field.id);
    }
    return { fields: [...fields], values: current, changed, pendingRestart };
  }

  /** Only what a person changed and still fits its field: equal to the default (or no longer valid) sends nothing. Secrets excluded. */
  async overrides(pluginId: string, fields: readonly SettingField[]): Promise<Record<string, SettingValue>> {
    const stored = (await this.open(pluginId)).values.read(file => file.values);
    return Object.fromEntries(fields.flatMap(field => {
      const value = stored[field.id];
      return field.owner === "store" && field.type !== "secret" && value !== undefined && checkSettingValue(field, value) === null && !equal(field, value)
        ? [[field.id, value]] : [];
    }));
  }

  /** A package's own settings (settings.get): defaults filled, secrets in clear. Never called for another package. */
  async packageValues(pluginId: string, fields: readonly SettingField[]): Promise<Record<string, SettingValue | null>> {
    const { values, secrets } = await this.open(pluginId);
    const stored = values.read(file => file.values), hidden = secrets.read(file => file.values);
    return Object.fromEntries(fields.filter(field => field.owner === "store").map(field => {
      if (field.type === "secret") return [field.id, typeof hidden[field.id] === "string" ? hidden[field.id] : null];
      const value = stored[field.id];
      return [field.id, value !== undefined && checkSettingValue(field, value) === null ? value : field.default];
    }));
  }

  /** Validates the whole patch first, then writes; returns the ids whose effective value changed. */
  async submit(pluginId: string, fields: readonly SettingField[], patch: SettingsPatch): Promise<string[]> {
    const byId = new Map(fields.map(field => [field.id, field]));
    for (const [id, value] of Object.entries(patch)) {
      const field = byId.get(id);
      if (!field || field.owner !== "store") throw new SettingsRefusal("setting-unknown");
      if (value !== null && checkSettingValue(field, value) !== null) throw new SettingsRefusal("setting-invalid");
    }
    const { values, secrets } = await this.open(pluginId);
    const changed: string[] = [];
    const plain = Object.entries(patch).filter(([id]) => byId.get(id)!.type !== "secret");
    const hidden = Object.entries(patch).filter(([id]) => byId.get(id)!.type === "secret");
    if (plain.length) await values.mutate(file => {
      for (const [id, value] of plain) {
        const field = byId.get(id)!, before = file.values[id] ?? (field.type === "secret" ? undefined : field.default);
        if (value === null || equal(field, value)) delete file.values[id]; else file.values[id] = value;
        const after = file.values[id] ?? (field.type === "secret" ? undefined : field.default);
        if (before !== after) changed.push(id);
      }
    });
    if (hidden.length) await secrets.mutate(file => {
      for (const [id, value] of hidden) {
        if (file.values[id] === (value ?? undefined)) continue;
        if (value === null) delete file.values[id]; else file.values[id] = value;
        changed.push(id);
      }
    });
    return changed;
  }

  async closeAndFlush() {
    for (const opened of this.files.values()) {
      const files = await opened.catch(() => null);
      if (files) await Promise.all([files.values.closeAndFlush(), files.secrets.closeAndFlush()]);
    }
  }
}
