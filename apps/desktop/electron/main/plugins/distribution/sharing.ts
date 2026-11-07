/**
 * [INPUT]: Depends on durable local JSON and exact account/plugin/revision identity contracts.
 * [OUTPUT]: Provides account-bound first-share consent and the exact last successfully published revision.
 * [POS]: Sharing authority ledger; only explicit Share grants consent, while automatic updates can only advance an existing grant.
 */
import { join } from "node:path";
import { z } from "zod";
import { pluginIdentitySchema, pluginDigestSchema } from "@bottega/contracts/plugins/platform";
import { DurableJson } from "../../persistence/durable-json";
const consent = z.object({ accountId: z.string().min(1).max(1024), pluginId: pluginIdentitySchema,
  sharedAt: z.number().int().nonnegative(), lastPublishedRevision: pluginDigestSchema }).strict();
const schema = z.object({ version: z.literal(1), consents: z.array(consent) }).strict();
export class PluginSharingConsent {
  private readonly file;
  private ready?: Promise<unknown>;
  constructor(userData: string) { this.file = new DurableJson(join(userData, "plugin-sharing.json"), schema, () => ({ version: 1 as const, consents: [] as z.infer<typeof consent>[] })); }
  initialize() { return this.ready ??= this.file.initialize(); }
  async get(accountId: string, pluginId: string) { await this.initialize(); return this.file.read(state => state.consents.find(value => value.accountId === accountId && value.pluginId === pluginId) ?? null); }
  async published(input: { accountId: string; pluginId: string; revisionId: string; explicit: boolean }, assertCurrent: () => void) {
    await this.initialize(); assertCurrent();
    await this.file.mutate(state => {
      assertCurrent();
      const existing = state.consents.find(value => value.accountId === input.accountId && value.pluginId === input.pluginId);
      if (existing) existing.lastPublishedRevision = input.revisionId;
      else if (input.explicit) state.consents.push({ accountId: input.accountId, pluginId: input.pluginId, sharedAt: Date.now(), lastPublishedRevision: input.revisionId });
      else throw new Error("Automatic plugin publication requires a prior explicit Share");
    });
    assertCurrent();
  }
  async close() { if (this.ready) { await this.ready; await this.file.closeAndFlush(); } }
}
