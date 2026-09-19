/**
 * [INPUT]: Depends on original publication source identities, the portable package verifier and durable no-follow file primitives.
 * [OUTPUT]: Retains and reads exact source bytes independently of installed records, releasing only a caller-confirmed source.
 * [POS]: AppStore file custody; the publication plan remains the sole upload state and these bytes confer no installation authority.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import { APP_SOURCE_LIMITS, verifyAppSourcePackage } from "@ai-chat/cloud-protocol/apps/source";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import { releaseAppCiphertext } from "./ciphertext";
import type { EncryptedFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { AppPublication } from "../../../store/portable/publication-model";
import { durableReplaceBytes, syncDirectory } from "../../../../persistence/durable-json";
type Source = NonNullable<AppPublication["source"]>;
export class AppSourceCustody {
  constructor(private userData: string) {}
  private directories(scope: SyncScope, appId: string) {
    if (!/^[a-z0-9]{10}$/.test(appId)) throw new Error("APP_SOURCE_ID_INVALID");
    const root = join(this.userData, "app-source-custody");
    const account = join(root, hashBytes(new TextEncoder().encode(canonicalJson(scope))));
    return [this.userData, root, account, join(account, appId)];
  }
  private async path(scope: SyncScope, appId: string, source: Source, create: boolean) {
    if (!/^[0-9a-f]{64}$/.test(source.sha256)) throw new Error("APP_SOURCE_ID_INVALID");
    const directories = this.directories(scope, appId);
    for (const path of directories) {
      let state = await stat(path);
      if (!state && create) {
        await mkdir(path, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
        await syncDirectory(dirname(path)); state = await stat(path);
      }
      if (!state) return null;
      if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("APP_SOURCE_CUSTODY_UNSAFE");
    }
    return join(directories.at(-1)!, `${source.sha256}.json`);
  }
  async read(scope: SyncScope, appId: string, source: Source) {
    const path = await this.path(scope, appId, source, false);
    if (!path || !await stat(path)) return null;
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size !== source.bytes || before.size > APP_SOURCE_LIMITS.wireBytes) throw new Error("APP_SOURCE_CUSTODY_CHANGED");
      const bytes = Buffer.alloc(before.size); let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error("APP_SOURCE_CUSTODY_CHANGED"); offset += bytesRead;
      }
      const after = await file.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("APP_SOURCE_CUSTODY_CHANGED");
      verify(source, bytes); return bytes;
    } finally { await file.close(); }
  }
  async retain(scope: SyncScope, appId: string, source: Source, bytes: Uint8Array) {
    verify(source, bytes);
    const path = (await this.path(scope, appId, source, true))!;
    if (await this.read(scope, appId, source)) return;
    await durableReplaceBytes(path, bytes);
    if (!await this.read(scope, appId, source)) throw new Error("APP_SOURCE_CUSTODY_CHANGED");
  }
  async release(scope: SyncScope, appId: string, source: Source, ciphertext?: { key: string; descriptor: EncryptedFileDescriptor }) {
    if (ciphertext) await releaseAppCiphertext(this.userData, scope, appId, source.sha256, ciphertext.key, ciphertext.descriptor);
    const path = await this.path(scope, appId, source, false);
    if (!path || !await stat(path)) return;
    await this.read(scope, appId, source);
    await unlink(path); await syncDirectory(dirname(path));
  }
}
function verify(source: Source, bytes: Uint8Array) {
  if (bytes.length !== source.bytes || hashBytes(bytes) !== source.sha256) throw new Error("APP_SOURCE_CUSTODY_CHANGED");
  const { files: _files, manifest: _manifest, ...metadata } = verifyAppSourcePackage(bytes);
  const { generationId: _generationId, sha256: _sha256, bytes: _bytes, ...expected } = source;
  if (canonicalJson(metadata) !== canonicalJson(expected)) throw new Error("APP_SOURCE_CUSTODY_CHANGED");
}
async function stat(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
