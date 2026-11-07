/**
 * [INPUT]: Depends on the durable JSON owner, exact Dock layout mutations, accepted plugin revisions and JSON Schema configuration validation.
 * [OUTPUT]: Provides persisted, idempotent Widget copy intents with ready-only retarget, bounded pending/error views and drained shutdown.
 * [POS]: Operation-loaded Dock copy owner; source preparation queues intent before completion and ordinary reconciliation consumes it.
 */
import { z } from "zod";
import { pluginIdentitySchema } from "@bottega/contracts/plugins/platform/selection/mode";
import type { UnifiedPluginPlatform } from "../../../plugins/platform/service";
import type { DockConfigStore } from "../../store/config-store";
import type { PluginDockWidget } from "../../../../../shared/system-dock/widgets/plugin";
import type { PluginWidgetCopyState } from "../../../../../shared/system-dock/widgets/authoring";
import { DurableJson } from "../../../persistence/durable-json";

const requestSchema = z.object({ sourcePluginId: pluginIdentitySchema, pluginId: pluginIdentitySchema, instanceId: pluginIdentitySchema }).strict();
const intentSchema = requestSchema.extend({ contributionId: pluginIdentitySchema, status: z.enum(["pending", "error"]), error: z.string().max(512).optional() }).strict();
const ledgerSchema = z.object({ version: z.literal(1), intents: z.array(intentSchema) }).strict();
export type PluginWidgetCopyInput = z.infer<typeof requestSchema>;
export type PluginWidgetCopyReceipt = PluginWidgetCopyInput & { status: "pending" | "error" | "applied"; error?: string };
type Intent = z.infer<typeof intentSchema>;
type Platform = Pick<UnifiedPluginPlatform, "get" | "activeRevision" | "isActive">;
type Ports = { filePath: string; config: DockConfigStore; platform(): Platform; changed(): void };

export class PluginDockCopyTargets {
  private readonly file: DurableJson<z.infer<typeof ledgerSchema>>;
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  constructor(private readonly ports: Ports) { this.file = new DurableJson(ports.filePath, ledgerSchema, () => ({ version: 1, intents: [] })); }
  async initialize() { await this.file.initialize(); }
  status(instanceId: string): PluginWidgetCopyState | undefined {
    const intent = this.file.read(state => state.intents.find(value => value.instanceId === instanceId));
    return intent ? { pluginId: intent.pluginId, status: intent.status, ...(intent.error ? { error: intent.error } : {}) } : undefined;
  }
  queue(raw: PluginWidgetCopyInput): Promise<PluginWidgetCopyReceipt> {
    return this.run(async () => {
      const input = requestSchema.parse(raw), platform = this.ports.platform(), copy = platform.get(input.pluginId), source = platform.get(input.sourcePluginId);
      if (input.pluginId === input.sourcePluginId || copy?.manifest.source.kind !== "copy" || copy.manifest.source.pluginId !== input.sourcePluginId || !source)
        throw new Error("Plugin Widget copy provenance changed");
      const item = this.ports.config.layout().items.find(value => value.id === input.instanceId);
      if (!item || item.kind !== "widget" || item.widget.type !== "plugin" || ![input.sourcePluginId, input.pluginId].includes(item.widget.pluginId))
        throw new Error("Plugin Widget copy target changed");
      const contributionId = item.widget.contributionId;
      for (const record of [source, copy]) if (!record.manifest.contributions.some(value => value.kind === "widget" && value.id === contributionId))
        throw new Error("Plugin Widget copy contribution is not declared");
      const existing = this.file.read(state => state.intents.find(value => value.instanceId === input.instanceId));
      if (existing && (existing.pluginId !== input.pluginId || existing.sourcePluginId !== input.sourcePluginId || existing.contributionId !== contributionId))
        throw new Error("Plugin Widget copy target has a conflicting intent");
      if (item.widget.pluginId === input.pluginId) { if (existing) await this.complete(existing); return { ...input, status: "applied" }; }
      if (existing) return { ...input, status: existing.status, ...(existing.error ? { error: existing.error } : {}) };
      await this.file.mutate(state => { state.intents.push({ ...input, contributionId, status: "pending" }); });
      this.ports.changed(); return { ...input, status: "pending" };
    });
  }
  reconcile(): Promise<void> {
    return this.run(async () => {
      for (const intent of this.file.read(state => state.intents)) {
        try {
          const active = this.active(intent);
          if (!active) { await this.report(intent, "pending"); continue; }
          const assertCurrent = () => { const current = this.active(intent); if (!current || current.revisionId !== active.revisionId) throw new Error("Plugin Widget copy is no longer ready"); };
          await this.ports.config.edit(layout => {
            assertCurrent();
            const item = layout.items.find(value => value.id === intent.instanceId);
            if (!item || item.kind !== "widget" || item.widget.type !== "plugin" || item.widget.contributionId !== intent.contributionId ||
              ![intent.sourcePluginId, intent.pluginId].includes(item.widget.pluginId)) throw new Error("Plugin Widget copy target changed or was removed");
            const configuration = z.fromJSONSchema((active.contribution.settingsSchema ?? { type: "object", additionalProperties: true }) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(item.widget.configuration);
            if (!configuration.success) throw new Error(`Plugin Widget copy configuration is incompatible: ${configuration.error.message}`);
            if (item.widget.pluginId === intent.pluginId) return layout;
            const widget: PluginDockWidget = { ...item.widget, pluginId: intent.pluginId };
            return { ...layout, items: layout.items.map(value => value.id === item.id ? { ...item, widget } : value) };
          }, undefined, async () => { assertCurrent(); });
          await this.complete(intent);
        } catch (cause) { await this.report(intent, "error", cause instanceof Error ? cause.message : String(cause)); }
      }
    });
  }
  private active(intent: Intent) {
    const platform = this.ports.platform(), copy = platform.get(intent.pluginId);
    if (!copy || copy.manifest.source.kind !== "copy" || copy.manifest.source.pluginId !== intent.sourcePluginId)
      throw new Error("Plugin Widget copy provenance changed or is unavailable");
    const revision = platform.activeRevision(intent.pluginId);
    if (!copy.installation.enabled || !revision || !platform.isActive(intent.pluginId, revision.revisionId)) {
      if (["failed", "cleanup-failed", "missing-source", "unavailable"].includes(copy.status)) throw new Error(copy.error ?? "Plugin Widget copy is unavailable");
      return null;
    }
    if (revision.manifest.source.kind !== "copy" || revision.manifest.source.pluginId !== intent.sourcePluginId) throw new Error("Accepted Plugin Widget copy provenance changed");
    const contribution = revision.manifest.contributions.find(value => value.kind === "widget" && value.id === intent.contributionId);
    if (!contribution || contribution.kind !== "widget") throw new Error("Accepted Plugin Widget copy contribution is unavailable");
    return { revisionId: revision.revisionId, contribution };
  }
  private async complete(intent: Intent) {
    await this.file.mutate(state => { state.intents = state.intents.filter(value => value.instanceId !== intent.instanceId); }); this.ports.changed();
  }
  private async report(intent: Intent, status: "pending" | "error", detail?: string) {
    const error = detail?.slice(0, 512);
    if (intent.status === status && intent.error === error) return;
    await this.file.mutate(state => { const current = state.intents.find(value => value.instanceId === intent.instanceId); if (current) { current.status = status; if (error) current.error = error; else delete current.error; } });
    this.ports.changed();
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("Plugin Widget copy owner is closed"));
    const result = this.tail.then(operation); this.tail = result.catch(() => {}); return result;
  }
  async close() { this.closing = true; await this.tail; await this.file.closeAndFlush(); }
}
