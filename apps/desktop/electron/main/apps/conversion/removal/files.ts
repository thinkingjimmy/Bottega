/**
 * [INPUT]: Depends on original local removal identities, the catalog's Store-owned source directory, no-follow filesystem reads and fsynced rename primitives.
 * [OUTPUT]: Retains an App workspace through an identity-fenced, restartable local rename and exposes its scoped archive directory.
 * [POS]: Local removal file custody; unpublished source and non-Base files never enter cloud storage or deletion cleanup.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { canonicalJson, hashCanonical } from "@ai-chat/cloud-protocol";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import { durableReplaceFile, syncDirectory } from "../../../persistence/durable-json";
import { appRemovalSchema, type AppRemoval } from "./contract";
const ownerSchema = z.object({ version: z.literal(1), requestId: z.string().min(1).max(192), input: appRemovalSchema,
  source: z.object({ dev: z.string(), ino: z.string() }).strict().nullable() }).strict();
export function localAppRemovalDirectory(userData: string, scope: SyncScope, appId: string) {
  if (!/^[a-z0-9]{10}$/.test(appId)) throw new Error("APP_REMOVAL_ID_INVALID");
  return join(userData, "app-local-removals", hashCanonical(scope), appId);
}
export class LocalAppRemovalFiles {
  readonly root: string;
  readonly source: string;
  readonly workspace: string;
  /** `source` is the Store-owned workspace of this App; only the catalog knows where the folder put it. */
  constructor(private userData: string, private requestId: string, private input: AppRemoval, source: string) {
    this.root = join(localAppRemovalDirectory(userData, input.scope, input.appId), hashCanonical({ requestId, input }));
    this.source = source; this.workspace = join(this.root, "workspace");
  }
  async retain(recordDirectory: string) {
    if (recordDirectory !== this.source) throw new Error("APP_REMOVAL_WORKSPACE_CHANGED");
    await directory(this.userData);
    await directory(dirname(this.source));
    const parents = [join(this.userData, "app-local-removals"), dirname(dirname(this.root)), dirname(this.root), this.root];
    for (const path of parents) await directory(path);
    const marker = join(this.root, "owner.json");
    let owner: z.infer<typeof ownerSchema>;
    if (await info(marker)) owner = await readOwner(marker);
    else {
      if ((await readdir(this.root)).length) throw new Error("APP_REMOVAL_ARCHIVE_UNOWNED");
      const source = await rootIdentity(this.source);
      owner = { version: 1, requestId: this.requestId, input: this.input, source };
      await durableReplaceFile(marker, canonicalJson(owner));
    }
    if (owner.requestId !== this.requestId || canonicalJson(owner.input) !== canonicalJson(this.input)) throw new Error("APP_REMOVAL_ARCHIVE_CHANGED");
    const source = await rootIdentity(this.source), retained = await rootIdentity(this.workspace);
    if (!owner.source) {
      if (source || retained) throw new Error("APP_REMOVAL_WORKSPACE_CHANGED");
      return;
    }
    if (retained) {
      if (source || canonicalJson(retained) !== canonicalJson(owner.source)) throw new Error("APP_REMOVAL_WORKSPACE_CHANGED");
      return;
    }
    if (!source || canonicalJson(source) !== canonicalJson(owner.source)) throw new Error("APP_REMOVAL_WORKSPACE_CHANGED");
    await rename(this.source, this.workspace);
    await syncDirectory(dirname(this.source)); await syncDirectory(this.root);
    if (canonicalJson(await rootIdentity(this.workspace)) !== canonicalJson(owner.source)) throw new Error("APP_REMOVAL_WORKSPACE_CHANGED");
  }
}
export async function hasLocalAppRemoval(userData: string, scope: SyncScope, appId: string) {
  const path = localAppRemovalDirectory(userData, scope, appId);
  for (const parent of [userData, join(userData, "app-local-removals"), dirname(path), path]) if (!await rootIdentity(parent)) return false;
  return true;
}
async function info(path: string) {
  try { return await lstat(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function rootIdentity(path: string) {
  const state = await info(path);
  if (!state) return null;
  if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("APP_REMOVAL_UNSAFE_DIRECTORY");
  return { dev: String(state.dev), ino: String(state.ino) };
}
async function directory(path: string) {
  let created = true;
  await mkdir(path, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; created = false; });
  await rootIdentity(path);
  if (created) await syncDirectory(dirname(path));
}
async function readOwner(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const state = await file.stat();
    if (!state.isFile() || state.nlink !== 1 || state.size > 8192) throw new Error("APP_REMOVAL_ARCHIVE_CHANGED");
    const bytes = Buffer.alloc(state.size); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("APP_REMOVAL_ARCHIVE_CHANGED"); offset += bytesRead;
    }
    const after = await file.stat();
    if (after.size !== state.size || after.mtimeMs !== state.mtimeMs || after.ctimeMs !== state.ctimeMs) throw new Error("APP_REMOVAL_ARCHIVE_CHANGED");
    return ownerSchema.parse(JSON.parse(bytes.toString("utf8")));
  } finally { await file.close(); }
}
