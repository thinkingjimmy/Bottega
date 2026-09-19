/**
 * [INPUT]: Depends on Base metadata, immutable sync generations and the selected folder's single writer.
 * [OUTPUT]: Publishes revision/hash-bound content and local pointers; reads rewrite a pointer only when it changed and missing local baselines restore content without uploads.
 * [POS]: Base split-publication boundary beneath BaseStoreFiles; receipts and encryption custody never enter portable metadata.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { baseMetaSchema } from "../../../../../shared/bases-schema";
import { type BaseMeta } from "../../../../../shared/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import { durableReplaceFile, isErrnoCode, syncDirectory } from "../../../persistence/durable-json";
import { ownerFileStem } from "../base-files";
import { serializeSync, syncPath, BASE_SYNC_BYTE_LIMIT } from "../sync/files";
import { baseSyncEnvelopeSchema, emptyBaseSync } from "../sync/model";
const fields = ["owner", "ownerInstanceId", "name", "navigation", "columns", "views", "activeViewId", "revision", "rowsGeneration", "galleryGeneration", "historyGeneration"] as const;
const pointerSchema = z.object({ version: z.literal(1), baseId: z.string(), contentRevision: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), syncGeneration: z.number().int().nonnegative(), syncHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Pointer = z.infer<typeof pointerSchema>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const portable = (meta: BaseMeta) => JSON.stringify({ version: 1, contentRevision: meta.revision, ...Object.fromEntries(fields.map(key => [key, meta[key]])) }, null, 2) + "\n";
export class BaseFolderPublication {
  constructor(readonly syncRoot: string, private checkpoint?: (phase: "intent" | "content" | "commit") => Promise<void>) {}
  private paths(meta: BaseMeta) {
    const path = join(this.syncRoot, `${ownerFileStem(ownerKeyOf(meta.owner))}.local.json`);
    return { path, intent: `${path}.intent` };
  }
  private async readPointer(path: string): Promise<Pointer | null> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error("BASE_FOLDER_POINTER_INVALID");
      return pointerSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) return null;
      await rename(path, `${path}.corrupt-${Date.now()}`);
      const prefix = path.slice(this.syncRoot.length + 1) + ".corrupt-";
      const old = (await readdir(this.syncRoot)).filter(name => name.startsWith(prefix)).sort().reverse().slice(3);
      for (const name of old) await rm(join(this.syncRoot, name));
      return null;
    }
  }
  async read(raw: unknown) {
    const envelope = z.object({ version: z.literal(1), contentRevision: z.number().int().nonnegative() }).parse(raw);
    const value = raw as Record<string, unknown>, meta = baseMetaSchema.parse(Object.fromEntries(fields.map(key => [key, value[key]])));
    if (envelope.contentRevision !== meta.revision) throw new Error("BASE_FOLDER_REVISION_CHANGED");
    await mkdir(this.syncRoot, { recursive: true, mode: 0o700 });
    const paths = this.paths(meta), intent = await this.readPointer(paths.intent), saved = await this.readPointer(paths.path);
    const matches = (pointer: Pointer | null): pointer is Pointer => Boolean(pointer && pointer.baseId === meta.ownerInstanceId &&
      pointer.contentRevision === meta.revision && pointer.contentHash === hash(portable(meta)));
    let pointer = matches(intent) ? intent : matches(saved) ? saved : null;
    if (pointer) {
      try {
        const path = syncPath(this.syncRoot, ownerKeyOf(meta.owner), pointer.syncGeneration), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > BASE_SYNC_BYTE_LIMIT) throw new Error("BASE_SYNC_FILE_INVALID");
        const text = await readFile(path, "utf8"), sync = baseSyncEnvelopeSchema.parse(JSON.parse(text));
        if (hash(text) !== pointer.syncHash || sync.baseId !== meta.ownerInstanceId) throw new Error("BASE_SYNC_IDENTITY_CHANGED");
      } catch { pointer = null; }
    }
    // Reading must not cost three fsyncs per Base at every launch; only a resolved pointer the profile does not already hold is written.
    const published = pointer === saved;
    if (!pointer) {
      // A fresh profile has no field baseline. Keep the content, never derive a patch from a newer cloud snapshot.
      const sync = serializeSync(emptyBaseSync(meta.ownerInstanceId)), generation = Math.max(Date.now(), (saved?.syncGeneration ?? 0) + 1);
      await durableReplaceFile(syncPath(this.syncRoot, ownerKeyOf(meta.owner), generation), sync.content);
      pointer = { version: 1, baseId: meta.ownerInstanceId, contentRevision: meta.revision, contentHash: hash(portable(meta)), syncGeneration: generation, syncHash: sync.hash };
    }
    if (!published) await durableReplaceFile(paths.path, JSON.stringify(pointer) + "\n");
    if (intent) { await rm(paths.intent); await syncDirectory(this.syncRoot); }
    return { ...meta, syncGeneration: pointer.syncGeneration, syncHash: pointer.syncHash };
  }
  async write(path: string, meta: BaseMeta, write: (path: string, content: string) => Promise<void>) {
    const text = portable(meta), paths = this.paths(meta), pointer = pointerSchema.parse({ version: 1, baseId: meta.ownerInstanceId,
      contentRevision: meta.revision, contentHash: hash(text), syncGeneration: meta.syncGeneration, syncHash: meta.syncHash });
    await mkdir(this.syncRoot, { recursive: true, mode: 0o700 });
    await write(paths.intent, JSON.stringify(pointer) + "\n"); await this.checkpoint?.("intent");
    await write(path, text); await this.checkpoint?.("content");
    await write(paths.path, JSON.stringify(pointer) + "\n"); await this.checkpoint?.("commit");
    await rm(paths.intent); await syncDirectory(this.syncRoot);
  }
}
