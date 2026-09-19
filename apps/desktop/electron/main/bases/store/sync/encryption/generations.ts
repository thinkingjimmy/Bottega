/**
 * [INPUT]: Visible meta digest, bounded original sync files and complete detached journal references.
 * [OUTPUT]: Read-only ciphertext roots from every retained generation; invalid recovery evidence aborts the plan.
 * [POS]: Filesystem inspection leaf used before collection; never mutates files or envelopes.
 */
import { type BaseMeta } from "../../../../../../shared/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import type { BaseStoreFiles } from "../../base-files";
import { baseSyncEnvelopeSchema } from "../model";
import { readSync, syncPath, BASE_SYNC_BYTE_LIMIT } from "../files";
import { baseCiphertextHashes } from "./roots";

export async function readBaseCiphertextRoots(files: BaseStoreFiles, meta: BaseMeta) {
  const ownerKey = ownerKeyOf(meta.owner), root = files.syncRoot;
  const current = baseCiphertextHashes(await readSync(files, root, meta)), hashes = new Set(current);
  for (const generation of await files.retainedSyncGenerations(ownerKey)) {
    if (generation === meta.syncGeneration) continue;
    const envelope = baseSyncEnvelopeSchema.parse(JSON.parse(await files.readBounded(syncPath(root, ownerKey, generation), BASE_SYNC_BYTE_LIMIT)));
    for (const hash of baseCiphertextHashes(envelope)) hashes.add(hash);
  }
  return { current, hashes };
}
