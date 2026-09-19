/**
 * [INPUT]: Depends on verified source envelopes, exact install identities, cross-volume directory publication and fsynced private files.
 * [OUTPUT]: Stages bounded source bytes, resumes pending backup/publication transactions and publishes editable workspaces while preserving previous contents.
 * [POS]: Fixed-identity install custody; every path is derived locally and no cloud package can select a destination.
 */
import { publishDirectory } from "../../store/folder/publication";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { APP_SOURCE_LIMITS, verifyAppSourcePackage } from "@ai-chat/cloud-protocol/apps/source";
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import { durableReplaceBytes, durableReplaceFile, syncDirectory } from "../../../persistence/durable-json";
import type { CloudAppInstall } from "./contract";
export class CloudAppInstallFiles {
  readonly root: string;
  readonly source: string;
  readonly configReference: string;
  constructor(private userData: string, readonly requestId: string, private input: CloudAppInstall,
    private workspaceDirectory = join(userData, "apps", input.descriptor.appId), private publication = publishDirectory) {
    const key = createHash("sha256").update(canonicalJson({ requestId, input })).digest("hex");
    this.configReference = `install-${key}`;
    this.root = join(userData, "app-cloud-installs", key); this.source = join(this.root, "source");
  }
  async stage(bytes: Uint8Array) {
    this.verify(bytes);
    await directory(this.userData); await directory(dirname(this.root)); await directory(this.root);
    const owner = canonicalJson({ version: 1, requestId: this.requestId, input: this.input });
    const marker = join(this.root, "owner.json");
    if (await exists(marker)) {
      if (new TextDecoder().decode(await readBounded(marker, 256 * 1024)) !== owner) throw new Error("APP_INSTALLATION_CUSTODY_CONFLICT");
    } else {
      if ((await readdir(this.root)).length) throw new Error("APP_INSTALLATION_CUSTODY_UNOWNED");
      await durableReplaceFile(marker, owner);
    }
    const path = join(this.root, "package.json");
    if (await exists(path)) this.verify(await readBounded(path, APP_SOURCE_LIMITS.wireBytes));
    else await durableReplaceBytes(path, bytes);
  }
  async read() {
    await directory(this.root);
    const owner = canonicalJson({ version: 1, requestId: this.requestId, input: this.input });
    if (new TextDecoder().decode(await readBounded(join(this.root, "owner.json"), 256 * 1024)) !== owner) throw new Error("APP_INSTALLATION_CUSTODY_CONFLICT");
    return this.verify(await readBounded(join(this.root, "package.json"), APP_SOURCE_LIMITS.wireBytes));
  }
  async prepare() {
    const verified = await this.read();
    if (await exists(this.source)) await verifyTree(this.source, verified.files);
    else await writeTree(this.root, this.source, verified.files);
    return verified;
  }
  async publishWorkspace(finalRoot: string) {
    if (finalRoot !== this.workspaceDirectory) throw new Error("APP_INSTALLATION_PATH_CONFLICT");
    const { files } = await this.read(), planPath = join(this.root, "workspace-plan.json");
    await directory(dirname(finalRoot));
    let hadWorkspace: boolean;
    if (await exists(planPath)) {
      const plan = JSON.parse(new TextDecoder().decode(await readBounded(planPath, 128)));
      if (typeof plan.hadWorkspace !== "boolean" || Object.keys(plan).length !== 1) throw new Error("APP_INSTALLATION_WORKSPACE_PLAN_INVALID");
      hadWorkspace = plan.hadWorkspace;
    } else {
      hadWorkspace = await exists(finalRoot);
      if (hadWorkspace) await directory(finalRoot);
      await durableReplaceFile(planPath, canonicalJson({ hadWorkspace }));
    }
    const previous = join(this.root, "previous-workspace"), prepared = join(this.root, "workspace");
    if (hadWorkspace) await this.publication.recover(finalRoot, previous);
    await this.publication.recover(prepared, finalRoot);
    if (hadWorkspace && !await exists(previous)) {
      await directory(finalRoot);
      await this.publication(finalRoot, previous); await syncDirectory(dirname(finalRoot)); await syncDirectory(this.root);
    }
    if (await exists(finalRoot)) { await verifyTree(finalRoot, files); return; }
    if (await exists(prepared)) await verifyTree(prepared, files);
    else await writeTree(this.root, prepared, files);
    await this.publication(prepared, finalRoot); await syncDirectory(dirname(finalRoot)); await syncDirectory(this.root);
  }
  private verify(bytes: Uint8Array) {
    const descriptor = this.input.descriptor;
    if (bytes.byteLength !== descriptor.sourceBlob.bytes || hashBytes(bytes) !== descriptor.sourceBlob.sha256) throw new Error("APP_INSTALLATION_BLOB_INTEGRITY");
    const verified = verifyAppSourcePackage(bytes);
    if (verified.sourcePackageDigest !== descriptor.sourcePackageDigest || verified.manifestDigest !== descriptor.manifestDigest) throw new Error("APP_INSTALLATION_PACKAGE_CONFLICT");
    return verified;
  }
}
async function exists(path: string) {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function directory(path: string) {
  let created = true;
  await mkdir(path, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; created = false; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("APP_INSTALLATION_UNSAFE_DIRECTORY");
  if (created) await syncDirectory(dirname(path));
}
async function readBounded(path: string, limit: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error("APP_INSTALLATION_FILE_INVALID");
    const bytes = new Uint8Array(info.size); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("APP_INSTALLATION_FILE_CHANGED"); offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error("APP_INSTALLATION_FILE_CHANGED");
    return bytes;
  } finally { await handle.close(); }
}
async function verifyTree(root: string, files: ReturnType<typeof verifyAppSourcePackage>["files"]) {
  await directory(root);
  for (const file of files) {
    let parent = root;
    for (const segment of file.path.split("/").slice(0, -1)) { parent = join(parent, segment); await directory(parent); }
    const bytes = await readBounded(join(root, file.path), APP_SOURCE_LIMITS.fileBytes);
    if (hashBytes(bytes) !== hashBytes(file.bytes)) throw new Error("APP_INSTALLATION_SOURCE_CHANGED");
  }
}
async function writeTree(parent: string, target: string, files: ReturnType<typeof verifyAppSourcePackage>["files"]) {
  const temporary = await mkdtemp(join(parent, ".source-"));
  try {
    for (const file of files) {
      let directoryPath = temporary;
      for (const segment of file.path.split("/").slice(0, -1)) { directoryPath = join(directoryPath, segment); await directory(directoryPath); }
      await durableReplaceBytes(join(temporary, file.path), file.bytes);
    }
    await syncDirectory(temporary); await rename(temporary, target); await syncDirectory(parent);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
