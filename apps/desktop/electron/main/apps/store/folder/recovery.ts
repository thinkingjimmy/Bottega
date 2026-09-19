/**
 * [INPUT]: Depends on a copied App's source directory, authenticated deletion identity and the AppStore queue.
 * [OUTPUT]: Preserves source under one new App identity, localized for the reader, without transporting installation authority or grants.
 * [POS]: Folder recovery leaf; the caller commits the copied record before retiring the original descriptor.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppRecord } from "../../../../../shared/apps-ipc";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import { canonicalJson, createInstallingAppRecord } from "../../support";
import { allocateForkTitle } from "../../../chats/chat-fork";
import { durableReplaceBytes, isErrnoCode, syncDirectory } from "../../../persistence/durable-json";
import { appRecordSchema } from "../app-store-schema";
import { appDeletionSchema, type CloudAppDeletion } from "@ai-chat/cloud-protocol/apps/model";
import type { AppPortableCatalog } from "../portable/model";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { restoredSourceNotice } from "./catalog";

export const restoredAppId = (scope: SyncScope, appId: string) =>
  createHash("sha256").update(canonicalJson(["deleted-folder-app", scope, appId])).digest("hex").slice(0, 10);

async function sourceFiles(root: string) {
  if (await realpath(root) !== root) throw new Error("APP_SOURCE_DIRECTORY_CHANGED");
  const files: Array<{ path: string; bytes: Buffer; mode: number }> = []; let size = 0;
  const visit = async (path: string, depth: number) => {
    if (depth > 32) throw new Error("APP_SOURCE_RECOVERY_LIMIT");
    for (const item of await readdir(join(root, path), { withFileTypes: true })) {
      if (item.isDirectory() && ["node_modules", ".git", "dist", ".next"].includes(item.name)) continue;
      const relative = join(path, item.name), file = join(root, relative);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error("APP_SOURCE_RECOVERY_SYMLINK");
      if (info.isDirectory()) { await visit(relative, depth + 1); continue; }
      if (!info.isFile() || files.length >= 20000 || info.size > 64 * 1024 * 1024 || size + info.size > 512 * 1024 * 1024) throw new Error("APP_SOURCE_RECOVERY_LIMIT");
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.ino !== info.ino || current.dev !== info.dev) throw new Error("APP_SOURCE_DIRECTORY_CHANGED");
        const bytes = await handle.readFile(); size += bytes.length;
        if (bytes.length !== info.size) throw new Error("APP_SOURCE_DIRECTORY_CHANGED");
        files.push({ path: relative, bytes, mode: info.mode & 0o777 });
      } finally { await handle.close(); }
    }
  };
  await visit("", 0); return files.sort((a, b) => a.path.localeCompare(b.path));
}
const fingerprint = (files: Awaited<ReturnType<typeof sourceFiles>>) => canonicalJson(files.map(file =>
  [file.path, file.mode, createHash("sha256").update(file.bytes).digest("hex")]));

export async function preserveAppSource(source: AppRecord, id: string, dir: string, titles: string[], locale: AppLocale) {
  const files = await sourceFiles(source.dir);
  let exists = false;
  try { await lstat(dir); exists = true; } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
  if (exists) {
    if (fingerprint(await sourceFiles(dir)) !== fingerprint(files)) throw new Error("APP_RECOVERY_TARGET_CHANGED");
  } else {
    await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
    if (await realpath(dirname(dir)) !== dirname(dir)) throw new Error("APP_SOURCE_DIRECTORY_CHANGED");
    const staging = `${dir}.copy-${randomUUID()}`;
    await mkdir(staging, { mode: 0o700 });
    for (const file of files) {
      const target = join(staging, file.path); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await durableReplaceBytes(target, file.bytes, file.mode);
    }
    if (fingerprint(await sourceFiles(source.dir)) !== fingerprint(files)) throw new Error("APP_SOURCE_CHANGED_DURING_COPY");
    await rename(staging, dir); await syncDirectory(dirname(dir));
  }
  return { ...createInstallingAppRecord({ id, dir, repoUrl: source.sourceRepoUrl ?? "", displayName: allocateForkTitle(source.displayName.slice(0, 110), titles),
    maintenance: null, addedAt: source.addedAt }), state: "update-failed" as const, origin: "local" as const,
    sourceRepoUrl: source.sourceRepoUrl, editableSource: true,
    lastError: { phase: "build" as const, message: restoredSourceNotice(locale) } };
}

export async function retainDeletedFolderApp(ports: { catalog: AppPortableCatalog; records: Map<string, AppRecord>; retired: ReadonlySet<string>;
  sourceDirectory(id: string): string; locale(): AppLocale; commit(catalog: AppPortableCatalog): Promise<void> }, scope: SyncScope, raw: CloudAppDeletion) {
  const deletion = appDeletionSchema.parse(raw), catalog = structuredClone(ports.catalog);
  const entry = catalog.entries.find(item => item.descriptor.appId === deletion.appId);
  if (!entry || entry.scope || entry.tombstoned || entry.descriptor.cloudRevision !== 0 ||
    catalog.publications.some(item => item.operation.appId === deletion.appId) ||
    entry.descriptor.projectId !== deletion.projectId || entry.descriptor.baseId !== deletion.baseId) throw new Error("APP_FOLDER_RECOVERY_CHANGED");
  const source = ports.records.get(deletion.appId), id = restoredAppId(scope, deletion.appId);
  const retirementRequired = !!(source?.generationBinding.active || source?.generationBinding.pending);
  if (ports.records.has(id) || ports.retired.has(id)) throw new Error("APP_RECOVERY_TARGET_CHANGED");
  const child = source && await preserveAppSource(source, id, ports.sourceDirectory(id), [...ports.records.values()].map(item => item.displayName), ports.locale());
  entry.scope = scope; entry.tombstoned = true; entry.deletion = deletion; entry.descriptor.cloudRevision = deletion.revision;
  if (child) ports.records.set(id, appRecordSchema.parse(child));
  if (!retirementRequired) ports.records.delete(deletion.appId);
  try { await ports.commit(catalog); }
  catch (error) { ports.records.delete(id); if (source) ports.records.set(source.id, source); throw error; }
  return child?.id ?? null;
}
