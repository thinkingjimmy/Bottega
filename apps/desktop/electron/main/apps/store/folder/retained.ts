/**
 * [INPUT]: Depends on the original App folder identity, exact uninstall request, bounded no-follow catalog reads and durable same-volume directory renames.
 * [OUTPUT]: Provides retainedAppDirectory, retainAppFolder and hasRetainedAppFolder for permanent original-owner uninstall custody.
 * [POS]: Operation-loaded AppFolderCatalog removal leaf; it stores no configuration or execution authority, and its relative receipt follows the Library.
 */
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { durableReplaceFile, isErrnoCode, syncDirectory } from "../../../persistence/durable-json";

const ownerSchema = z.object({
  version: z.literal(1), appId: z.string().regex(/^[a-z0-9]{10}$/), requestId: z.string().min(1).max(256),
  source: z.object({ dev: z.string(), ino: z.string() }).strict(),
  catalogDigest: z.string().regex(/^[a-f0-9]{64}$/), retained: z.boolean(),
}).strict();
type Owner = z.infer<typeof ownerSchema>;
const failure = () => new Error("APP_RETENTION_CUSTODY_CHANGED");

export function retainedAppDirectory(appsRoot: string, appId: string, requestId: string) {
  if (!/^[a-z0-9]{10}$/.test(appId) || !requestId || requestId.length > 256) throw new Error("APP_RETENTION_INPUT_INVALID");
  return join(appsRoot, ".retained", appId, hashCanonical({ appId, requestId }), "app");
}
async function directory(path: string, create = false) {
  let created = false;
  if (create) await mkdir(path, { mode: 0o700 }).then(() => { created = true; }, error => { if (!isErrnoCode(error, "EEXIST")) throw error; });
  const info = await lstat(path, { bigint: true }).catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
  if (info && (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path)) throw failure();
  if (created) await syncDirectory(dirname(path));
  return info ? { dev: String(info.dev), ino: String(info.ino) } : null;
}
async function bytes(path: string, limit: number) {
  const before = await lstat(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit || info.dev !== before.dev || info.ino !== before.ino) throw failure();
    const result = await handle.readFile(), after = await handle.stat();
    if (result.length !== info.size || info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) throw failure();
    return result;
  } finally { await handle.close(); }
}
const digest = async (app: string) => createHash("sha256").update(await bytes(join(app, "app.json"), 64 * 1024 * 1024)).digest("hex");
async function locations(appsRoot: string, appId: string, requestId: string, create: boolean) {
  const target = retainedAppDirectory(appsRoot, appId, requestId), parent = dirname(target);
  for (const path of [appsRoot, join(appsRoot, ".retained"), join(appsRoot, ".retained", appId), parent]) {
    if (!await directory(path, create && path !== appsRoot)) return null;
  }
  return { target, parent, marker: join(parent, "owner.json") };
}
async function readOwner(marker: string, appId: string, requestId: string): Promise<Owner | null> {
  let value: unknown;
  try { value = JSON.parse((await bytes(marker, 16 * 1024)).toString("utf8")); }
  catch (cause) { if (isErrnoCode(cause, "ENOENT")) return null; throw failure(); }
  const parsed = ownerSchema.safeParse(value);
  if (!parsed.success || parsed.data.appId !== appId || parsed.data.requestId !== requestId) throw failure();
  return parsed.data;
}
async function verified(owner: Owner, target: string) {
  if (!await directory(target) || await digest(target) !== owner.catalogDigest) throw failure();
}

export async function retainAppFolder(appsRoot: string, appId: string, requestId: string) {
  const paths = await locations(appsRoot, appId, requestId, true);
  if (!paths) throw failure();
  const source = join(appsRoot, appId);
  let owner = await readOwner(paths.marker, appId, requestId);
  if (!owner) {
    if ((await readdir(paths.parent)).length) throw new Error("APP_RETENTION_TARGET_OCCUPIED");
    const identity = await directory(source);
    if (!identity) throw new Error("APP_RETENTION_SOURCE_MISSING");
    owner = { version: 1, appId, requestId, source: identity, catalogDigest: await digest(source), retained: false };
    await durableReplaceFile(paths.marker, JSON.stringify(owner) + "\n");
  }
  const from = await directory(source), to = await directory(paths.target);
  if (owner.retained) {
    await verified(owner, paths.target);
    if (from) throw failure();
    return;
  }
  if (to) {
    if (from || to.dev !== owner.source.dev || to.ino !== owner.source.ino) throw failure();
  } else {
    if (!from || from.dev !== owner.source.dev || from.ino !== owner.source.ino || await digest(source) !== owner.catalogDigest) throw failure();
    await rename(source, paths.target);
    await syncDirectory(appsRoot); await syncDirectory(paths.parent);
  }
  await verified(owner, paths.target);
  await durableReplaceFile(paths.marker, JSON.stringify({ ...owner, retained: true }) + "\n");
}

export async function hasRetainedAppFolder(appsRoot: string, appId: string, requestId: string) {
  const paths = await locations(appsRoot, appId, requestId, false);
  if (!paths) return false;
  const owner = await readOwner(paths.marker, appId, requestId);
  if (!owner?.retained) return false;
  await verified(owner, paths.target);
  return true;
}
