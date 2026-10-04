/**
 * [INPUT]: Zod and strict canonical key-package, fingerprint and source-scope contracts.
 * [OUTPUT]: Validated native sync-key/cache creation records and closed storage failure codes.
 * [POS]: Main-only persistence format; root bytes and creation material never cross renderer IPC.
 */
import { z } from "zod";
import { decodeBase64url, fingerprintKeyPackage, parseKeyPackage, scopeTuple, MAX_KEY_PACKAGE_BYTES } from "@ai-chat/cloud-protocol/encryption";
const id = z.string().min(1).max(128);
const scope = z.object({ sourceEnvironment: id, sourceAccountId: id, vaultId: id, keyId: id }).strict();
const record = z.object({ format: z.literal(1), environmentId: id, deploymentId: id, installationId: id, userId: id,
  sessionId: id, deviceId: id, restoreGeneration: id,
  scope, keyPackage: z.string().max(Math.ceil(MAX_KEY_PACKAGE_BYTES * 4 / 3)), keyPackageFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  rootKey: z.string().length(43), createOperationId: id, phase: z.enum(["prepared", "accepted"]),
}).strict();
export type SyncKeyRecord = z.infer<typeof record>;
export type SyncKeyStorageCode = "sync-key-storage-unavailable" | "sync-key-cache-unreadable" | "sync-key-save-failed" | "sync-space-changed" | "sync-operation-cancelled";
export class SyncKeyStorageError extends Error {
  constructor(readonly code: SyncKeyStorageCode) { super(code); this.name = "SyncKeyStorageError"; }
}
export function parseSyncKeyRecord(value: unknown): SyncKeyRecord {
  try {
    const parsed = record.parse(value);
    const bytes = decodeBase64url(parsed.keyPackage, 1, MAX_KEY_PACKAGE_BYTES), key = parseKeyPackage(bytes);
    if (fingerprintKeyPackage(bytes) !== parsed.keyPackageFingerprint || key.createOperationId !== parsed.createOperationId ||
      JSON.stringify(scopeTuple(key.scope)) !== JSON.stringify(scopeTuple(parsed.scope))) throw new Error("invalid-key-binding");
    const root = decodeBase64url(parsed.rootKey, 32); root.fill(0);
    return parsed;
  } catch { throw new SyncKeyStorageError("sync-key-cache-unreadable"); }
}
