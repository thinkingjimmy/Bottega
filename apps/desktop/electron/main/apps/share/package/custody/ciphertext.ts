/**
 * [INPUT]: Original App publication source identity, its existing Store queue and durable no-follow JSON files.
 * [OUTPUT]: Bounded immutable file intent/part/completion records under the original source custody directory.
 * [POS]: App publication byte custody; it cannot schedule, enroll or create another business outbox.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import { frozenFileRecordSchema, type FrozenFileJournal, type FrozenFileRecord } from "@ai-chat/cloud-protocol/blobs/encrypted/journal";
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import { durableReplaceFile, syncDirectory } from "../../../../persistence/durable-json";
const maximumBytes = 2_097_152;
type Commit = <T>(operation: () => Promise<T>) => Promise<T>;
export function appCiphertextJournal(userData: string, scope: SyncScope, appId: string, sourceHash: string, commit: Commit): FrozenFileJournal {
  if (!/^[a-z0-9]{10}$/.test(appId) || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error("APP_SOURCE_ID_INVALID");
  const account = hashBytes(new TextEncoder().encode(canonicalJson(scope)));
  const directories = [userData, join(userData, "app-source-custody"), join(userData, "app-source-custody", account),
    join(userData, "app-source-custody", account, appId), join(userData, "app-source-custody", account, appId, sourceHash + "-ciphertext")];
  const path = async (key: string, create: boolean) => {
    if (!key || key.length > 256) throw new Error("APP_CIPHERTEXT_KEY_INVALID");
    for (const directory of directories) {
      let state = await stat(directory);
      if (!state && create) {
        await mkdir(directory, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
        await syncDirectory(dirname(directory)); state = await stat(directory);
      }
      if (!state) return null;
      if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("APP_SOURCE_CUSTODY_UNSAFE");
    }
    return join(directories.at(-1)!, hashBytes(new TextEncoder().encode(key)) + ".json");
  };
  const read = async (key: string): Promise<FrozenFileRecord | null> => {
    const location = await path(key, false); if (!location || !await stat(location)) return null;
    const file = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > maximumBytes) throw new Error("APP_CIPHERTEXT_CUSTODY_CHANGED");
      const bytes = Buffer.alloc(before.size); let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error("APP_CIPHERTEXT_CUSTODY_CHANGED"); offset += bytesRead;
      }
      const after = await file.stat();
      if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("APP_CIPHERTEXT_CUSTODY_CHANGED");
      return frozenFileRecordSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } finally { await file.close(); }
  };
  return { read, write: (key, input) => commit(async () => {
    const previous = await read(key); if (previous) return previous;
    const value = frozenFileRecordSchema.parse(input), json = canonicalJson(value);
    if (Buffer.byteLength(json) > maximumBytes) throw new Error("APP_CIPHERTEXT_CUSTODY_CHANGED");
    const location = (await path(key, true))!; await durableReplaceFile(location, json);
    const stored = await read(key); if (!stored || canonicalJson(stored) !== json) throw new Error("APP_CIPHERTEXT_CUSTODY_CHANGED"); return stored;
  }) };
}
async function stat(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function releaseAppCiphertext(userData: string, scope: SyncScope, appId: string, sourceHash: string, key: string, input: EncryptedFileDescriptor) {
  const descriptor = encryptedFileDescriptorSchema.parse(input);
  if (descriptor.sha256 !== sourceHash || descriptor.encryption.owner.kind !== "app" || descriptor.encryption.owner.id !== appId)
    throw new Error("APP_SOURCE_CUSTODY_CHANGED");
  const account = hashBytes(new TextEncoder().encode(canonicalJson(scope))), journal = appCiphertextJournal(userData, scope, appId, sourceHash,
    async () => { throw new Error("APP_CIPHERTEXT_RELEASE_READ_ONLY"); });
  const directory = join(userData, "app-source-custody", account, appId, sourceHash + "-ciphertext");
  const keys = [key + ":intent", ...descriptor.encryption.parts.map(part => `${key}:part:${part.partIndex}`), key + ":complete"];
  for (const name of keys) {
    const record = await journal.read(name); if (!record) continue;
    if (record.key !== key || (record.kind === "encrypted-file-intent" ? record.identity.blobId : record.kind === "encrypted-file-part" ? record.blobId : record.descriptor.blobId) !== descriptor.blobId)
      throw new Error("APP_SOURCE_CUSTODY_CHANGED");
  }
  for (const name of keys) {
    if (!await journal.read(name)) continue;
    await unlink(join(directory, hashBytes(new TextEncoder().encode(name)) + ".json"));
  }
  if (await stat(directory)) {
    await syncDirectory(directory);
    await rmdir(directory).catch(error => { if (!["ENOTEMPTY", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; });
    await syncDirectory(dirname(directory));
  }
}
