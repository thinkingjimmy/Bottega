/**
 * [INPUT]: Depends on actual BaseStore capture, formal owner initialization and revision-fenced cloud reads.
 * [OUTPUT]: Enrolls each local Base once from its empty cloud baseline or preserves an unpublished identity collision before canonical adoption.
 * [POS]: Initial Base adapter; App identities are created by the App lifecycle before this step.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { prepareEncryptedBaseInitial, createEncryptedBaseReader, type BaseCipherPort, type BaseCipherFiles } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import type { BaseStore } from "../../../bases/base-store";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../runtime/transport";
import type { ProjectStore } from "../../../projects/store/project-store";
import { recoverInitialBaseIdentity } from "./identity";
export async function captureInitialBase(input: { store: BaseStore; projects?: ProjectStore; transport: Pick<AccountTransport, "query" | "mutate">;
  crypto(): BaseCipherPort; files?: BaseCipherFiles;
  config: CloudBuildConfig; scope: SyncScope; ownerKey: string; baseId: string; manifestId: string; signal: AbortSignal }) {
  const { store, transport, scope, ownerKey, baseId, signal } = input;
  signal.throwIfAborted();
  const envelope = store.sync.read(ownerKey, baseId);
  if (envelope.scope) {
    if (envelope.scope.userId !== scope.userId || envelope.scope.environment !== scope.environment) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE");
    if (envelope.cloudState !== "local-only") return baseId;
  }
  const local = store.get(ownerKey); if (!local || local.meta.ownerInstanceId !== baseId) throw new Error("BASE_IDENTITY_CONFLICT");
  const port = input.crypto(), header = { ...protocolHeader(input.config), expectedUserId: scope.userId,
    encryptedSpace: { scope: port.scope, keyPackageFingerprint: port.keyPackageFingerprint } };
  if (local.meta.owner.kind === "project") {
    const projectId = local.meta.owner.projectId;
    const catalog = await transport.query("bases/catalog/api:list", { ...header, projectId, cursor: null });
    signal.throwIfAborted();
    const existing = catalog.items.find(item => item.owner.kind === "project" && item.owner.projectId === projectId);
    if (existing && existing.baseId !== baseId) {
      if (!input.projects) throw new Error("BASE_INITIAL_IDENTITY_CONFLICT");
      const { baseId: _id, receipts: _receipts, tombstones, ...confirmed } = await createEncryptedBaseReader({ transport, crypto: input.crypto,
        files: input.files, pair: () => undefined }, header, existing.baseId).read([]);
      return recoverInitialBaseIdentity({ store, projects: input.projects, scope, ownerKey, baseId, confirmed, tombstones,
        current: () => signal.throwIfAborted() });
    }
  }
  const { syncGeneration: _syncGeneration, syncHash: _syncHash, ...meta } = local.meta;
  let initial = envelope.initialCiphertext?.initial;
  if (envelope.initialCiphertext && (envelope.initialCiphertext.scope.userId !== scope.userId || envelope.initialCiphertext.scope.environment !== scope.environment)) throw new Error("BASE_SYNC_SCOPE_CONFLICT");
  if (!initial) {
    const prepared = await prepareEncryptedBaseInitial(port, { meta, operationId: crypto.randomUUID() }); signal.throwIfAborted();
    initial = await store.sync.freezeInitial(ownerKey, baseId, scope, prepared);
  }
  const initialized = await transport.mutate("bases/api:ensure", { ...header, initial });
  signal.throwIfAborted();
  const { baseId: _id, receipts: _receipts, tombstones, ...confirmed } = await createEncryptedBaseReader({ transport, crypto: input.crypto, files: input.files,
    pair: () => undefined }, header, initialized.baseId).read([]);
  if (initialized.baseId !== baseId || !initialized.created || confirmed.cloudRevision > 0 || confirmed.rows.length > 0) {
    if (!input.projects) throw new Error("BASE_INITIAL_IDENTITY_CONFLICT");
    return recoverInitialBaseIdentity({ store, projects: input.projects, scope, ownerKey, baseId, confirmed, tombstones,
      current: () => signal.throwIfAborted() });
  }
  signal.throwIfAborted(); await store.sync.captureInitial(ownerKey, baseId, scope, confirmed, input.manifestId);
  return baseId;
}
