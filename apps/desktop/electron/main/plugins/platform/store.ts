/**
 * [INPUT]: DurableJson, unified entity schemas and Node identity/path helpers.
 * [OUTPUT]: Strict plugin directory/activation authority, private accepted-source receipts and startup crash quarantine.
 * [POS]: Single durable CAS ledger for the unified platform; does not rewrite historical formats.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  pluginSafeModeSchema, unifiedPluginActivationRecordSchema, unifiedPluginCatalogItemSchema, unifiedPluginRevisionSchema,
} from "@bottega/contracts/plugins/platform";
import { DurableJson } from "../../persistence/durable-json";

export const pluginSourceBuildSchema = z.object({ sourceDirectory: z.string().min(1).max(4096).refine(value => value.startsWith("/")),
  sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), revisionId: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
export const unifiedPluginStoredRecordSchema = unifiedPluginCatalogItemSchema.omit({ runtimeReady: true }).extend({
  revisions: z.array(unifiedPluginRevisionSchema), activation: unifiedPluginActivationRecordSchema.nullable(),
  sourceVersion: z.number().int().nonnegative(), sourceBuild: pluginSourceBuildSchema.optional(),
});
const startupSchema = z.object({
  sessionId: z.string().uuid(), startedAt: z.number().int().nonnegative(),
  healthyAt: z.number().int().nonnegative().optional(), cleanExit: z.boolean(),
}).strict();
const fileSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  plugins: z.array(unifiedPluginStoredRecordSchema), safeMode: pluginSafeModeSchema.optional(),
  startup: startupSchema.optional(),
  removedOfficialWidgets: z.array(z.enum(["bottega-weather", "bottega-ai-usage"])).max(2).default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.plugins.map(record => record.manifest.id)).size !== value.plugins.length)
    context.addIssue({ code: "custom", message: "Duplicate plugin identity" });
  const directories = value.plugins.map(record => record.directory.sourceDirectory ?? record.directory.packageDirectory);
  if (new Set(directories).size !== directories.length) context.addIssue({ code: "custom", message: "A source directory has multiple plugin identities" });
  for (const record of value.plugins) {
    const id = record.manifest.id;
    if (record.installation.pluginId !== id || record.directory.pluginId !== id || (record.sourceProject && record.sourceProject.pluginId !== id))
      context.addIssue({ code: "custom", message: "Plugin record identity mismatch" });
    if (record.activation && (record.activeRevision !== record.activation.revisionId ||
      !record.revisions.some(revision => revision.revisionId === record.activation?.revisionId && revision.valid)))
      context.addIssue({ code: "custom", message: "Activation must identify an available sealed revision" });
    if (new Set(record.revisions.map(revision => revision.revisionId)).size !== record.revisions.length)
      context.addIssue({ code: "custom", message: "Duplicate immutable revision identity" });
  }
});
export type UnifiedPluginStoredRecord = z.infer<typeof unifiedPluginStoredRecordSchema>;
export type UnifiedPluginState = z.infer<typeof fileSchema>;

export class UnifiedPluginStore {
  readonly file: DurableJson<UnifiedPluginState>;
  private sessionId = randomUUID();
  constructor(userData: string, private now: () => number) {
    this.file = new DurableJson(join(userData, "plugin-platform.json"), fileSchema,
      () => ({ schemaVersion: 1, revision: 0, plugins: [], removedOfficialWidgets: [] }));
  }
  async initialize() {
    await this.file.initialize();
    await this.file.mutate(state => {
      if (state.startup && !state.startup.cleanExit && state.startup.healthyAt === undefined) {
        const suspect = state.plugins.filter(record => record.installation.enabled && !record.manifest.essential && record.activation)
          .sort((a, b) => (b.activation?.activatedAt ?? 0) - (a.activation?.activatedAt ?? 0))[0];
        if (suspect) {
          const reason = "The previous startup ended before plugins became stable. The most recently updated plugin was disabled.";
          suspect.installation.enabled = false; suspect.status = "disabled"; suspect.error = reason;
          state.safeMode = { pluginId: suspect.manifest.id, revisionId: suspect.activeRevision, reason, detectedAt: this.now(),
            repair: { pluginId: suspect.manifest.id, action: "edit-or-restore" } };
        }
      }
      state.startup = { sessionId: this.sessionId, startedAt: this.now(), cleanExit: false };
      state.revision++;
    });
  }
  async markHealthy() {
    await this.file.mutate(state => {
      if (state.startup?.sessionId === this.sessionId && !state.startup.cleanExit) state.startup.healthyAt = this.now();
    });
  }
  async markClean() {
    await this.file.mutate(state => {
      if (state.startup?.sessionId === this.sessionId) state.startup.cleanExit = true;
    });
  }
  read<R>(select: (state: Readonly<UnifiedPluginState>) => R): R { return this.file.read(select); }
  mutate<R>(operation: (state: UnifiedPluginState) => R | Promise<R>) {
    return this.file.mutate(async state => { const result = await operation(state); state.revision++; return result; });
  }
  close() { return this.file.closeAndFlush(); }
}
