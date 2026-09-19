/**
 * [INPUT]: Depends on the exact account/deployment cache namespace and stopped transfer owners.
 * [OUTPUT]: Removes owned disposable bytes and exact access receipts after canonical custody verification.
 * [POS]: Account cache cleanup; Chat Home, Chat attachments and Base families are separate durable owners.
 */
import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { syncDirectory, isErrnoCode } from "../../persistence/durable-json";
import { blobCacheDirectory } from "./store";
export async function removeAccountDownloadCache(userData: string, scope: { environmentId: string; deploymentId: string; userId: string }) {
  const root = blobCacheDirectory(userData, scope);
  try {
    for (const path of [dirname(root), root]) {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("CLEANUP_CACHE_IDENTITY_CHANGED");
    }
    const files = await readdir(root, { withFileTypes: true });
    for (const file of files) if (!file.isFile() || !/^(?:[a-f0-9]{64}\.bin|receipt-[a-f0-9]{64}\.json|\.(?:part|receipt)-[a-f0-9-]{36})$/.test(file.name)) throw new Error("CLEANUP_CACHE_UNKNOWN_ENTRY");
    for (const file of files) await unlink(join(root, file.name)).catch(error => { if (!isErrnoCode(error, "ENOENT")) throw error; });
    await syncDirectory(root); await rmdir(root); await syncDirectory(dirname(root));
    return { removedFiles: files.length };
  } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; return { removedFiles: 0 }; }
}
