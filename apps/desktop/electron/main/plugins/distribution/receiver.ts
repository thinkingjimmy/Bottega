/**
 * [INPUT]: Depends on verified complete package bytes, durable receiver receipts and the unified platform activation owner.
 * [OUTPUT]: Receives immutable precompiled UI/service/tool packages with trust confirmation and original-operation receipts.
 * [POS]: Main package receiver; no compiler, dependency installer, writable source Project or source Chat is created.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { unifiedPluginManifestSchema, type UnifiedPluginInstallInput } from "@bottega/contracts/plugins/platform";
import { DurableJson } from "../../persistence/durable-json";
import type { UnifiedPluginPlatform } from "../platform/service";
import { importPluginDistribution } from "../integration/distribution";
import { verifyUnifiedPluginDistribution } from "./verify";
const receipt = z.object({ operationId: z.string(), pluginId: z.string(), revisionId: z.string(), phase: z.enum(["prepared", "installed", "failed"]), error: z.string().optional() }).strict();
type ReceiveAuthority = { signal?: AbortSignal; assertCurrent?(): void; operationId?: string };
const queues = new WeakMap<UnifiedPluginPlatform, Promise<unknown>>();
export function receiveUnifiedPluginDistribution(platform: UnifiedPluginPlatform, userData: string, input: UnifiedPluginInstallInput, authority: ReceiveAuthority = {}) {
  const previous = queues.get(platform) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => receive(platform, userData, input, authority));
  queues.set(platform, task.catch(() => undefined)); return task;
}
async function receive(platform: UnifiedPluginPlatform, userData: string, input: UnifiedPluginInstallInput, authority: ReceiveAuthority) {
  const assertCurrent = () => { authority.signal?.throwIfAborted(); authority.assertCurrent?.(); };
  assertCurrent();
  const checked = await verifyUnifiedPluginDistribution(input.directory), distribution = checked.distribution;
  if (input.expectedManifestDigest && input.expectedManifestDigest !== distribution.manifestDigest) throw new Error("Plugin package changed after installation review");
  assertCurrent();
  const existing = platform.get(distribution.pluginId);
  if (existing && existing.installation.origin !== "external") throw new Error("A received package cannot replace an official or authored plugin; create an independent copy");
  if (!input.trust && !existing?.installation.trustAcceptedAt) throw new Error("Trust confirmation is required: plugin code can read all Bottega credentials and browser cookies");
  const journal = new DurableJson(join(userData, "plugin-package-receipts.json"), z.object({ version: z.literal(1), operations: z.array(receipt).max(1024) }).strict(), () => ({ version: 1 as const, operations: [] as z.infer<typeof receipt>[] }));
  await journal.initialize();
  const operationId = authority.operationId ?? randomUUID();
  try {
    const revision = await importPluginDistribution({ directory: input.directory, buildsRoot: join(userData, "plugin-packages"), sourceVersion: 0 });
    assertCurrent();
    const manifest = unifiedPluginManifestSchema.parse({ ...distribution.manifest, source: { ...distribution.manifest.source, kind: "external", editable: false } });
    await journal.mutate(state => { state.operations = [...state.operations.slice(-1023), { operationId, pluginId: manifest.id, revisionId: distribution.revisionId, phase: "prepared" }]; });
    assertCurrent();
    await platform.register({ manifest, packageDirectory: revision.rootDirectory, trust: true, replace: Boolean(existing), assertCurrent,
      ...(existing && !existing.acceptedRevision ? { enabled: true } : {}) });
    assertCurrent();
    const sourceVersion = await platform.sourceChanged(manifest.id, undefined, assertCurrent);
    assertCurrent();
    const result = !platform.get(manifest.id)?.installation.enabled
      ? await platform.acceptInactivePackage({ ...revision, sourceVersion }, assertCurrent)
      : await platform.activateCandidate({ ...revision, sourceVersion }, { signal: authority.signal });
    await journal.mutate(state => { const entry = state.operations.find(value => value.operationId === operationId)!; entry.phase = "installed"; });
    return result;
  } catch (cause) {
    await journal.mutate(state => { const entry = state.operations.find(value => value.operationId === operationId); if (entry) { entry.phase = "failed"; entry.error = String((cause as Error).message).slice(0, 2048); } });
    throw cause;
  } finally { await journal.closeAndFlush(); }
}
