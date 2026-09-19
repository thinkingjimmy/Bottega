/**
 * [INPUT]: Depends on the versioned envelope codec and BaseStoreFiles durable generation writer.
 * [OUTPUT]: Provides the shared byte budget, digest-bound envelope read/write and frozen state validation.
 * [POS]: Required dependency of the meta publication point; never writes an independent post-commit queue.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { BaseMeta } from "../../../../../shared/bases-ipc";

import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import { BaseStoreFiles, ownerFileStem } from "../base-files";
import { baseSyncEnvelopeSchema, type BaseSyncEnvelope } from "./model";
export const BASE_SYNC_BYTE_LIMIT = 64 * 1024 * 1024;
export function syncPath(root: string, ownerKey: string, generation: number) {
  return join(root, `${ownerFileStem(ownerKey)}.sync.${generation}.json`);
}
export function serializeSync(envelope: BaseSyncEnvelope) {
  const content = `${JSON.stringify(baseSyncEnvelopeSchema.parse(envelope))}\n`;
  if (Buffer.byteLength(content) > BASE_SYNC_BYTE_LIMIT) throw new Error("Base synchronization state exceeds 64 MiB");
  return { content, hash: createHash("sha256").update(content).digest("hex") };
}
export async function readSync(files: BaseStoreFiles, root: string, meta: BaseMeta) {
  if (meta.syncGeneration === undefined || !meta.syncHash) throw new Error("Base storage format requires a synchronization envelope");
  const content = await files.readBounded(syncPath(files.syncRoot, ownerKeyOf(meta.owner), meta.syncGeneration), BASE_SYNC_BYTE_LIMIT);
  if (createHash("sha256").update(content).digest("hex") !== meta.syncHash) throw new Error("Base synchronization envelope checksum mismatch");
  const envelope = baseSyncEnvelopeSchema.parse(JSON.parse(content));
  if (envelope.baseId !== meta.ownerInstanceId) throw new Error("Base synchronization identity mismatch");
  return envelope;
}
