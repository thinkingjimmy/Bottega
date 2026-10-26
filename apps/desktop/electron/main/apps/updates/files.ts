/**
 * [INPUT]: Durable replacement, bounded package projection, operation-owned profile paths and source-volume rename.
 * [OUTPUT]: Strict transaction custody, candidate verification, complete source backup and restart-safe source replacement.
 * [POS]: Update filesystem boundary; source backups outlive transaction cleanup and user Base data is never opened for writing.
 */
import { chmod, cp, lstat, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { durableReplaceFile, syncDirectory } from "../../persistence/durable-json";
import { inspectPackage, packageDigest, copyPackage, removePackageArtifact } from "../share/package/package-contract";
import { transactionSchema, type UpdateTransaction } from "./contract";
export class UpdateFiles {
  readonly root: string;
  constructor(userData: string) { this.root = join(userData, "preset-updates"); }
  operation(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error("APP_UPDATE_OPERATION_INVALID");
    return join(this.root, id);
  }
  candidate(id: string) { return join(this.operation(id), "candidate"); }
  build(id: string) { return join(this.operation(id), "build"); }
  async read(id: string) { return transactionSchema.parse(JSON.parse(await readFile(join(this.operation(id), "transaction.json"), "utf8"))); }
  async save(tx: UpdateTransaction) {
    const next = transactionSchema.parse({ ...tx, updatedAt: Date.now() });
    await mkdir(this.operation(tx.operationId), { recursive: true, mode: 0o700 });
    await durableReplaceFile(join(this.operation(tx.operationId), "transaction.json"), JSON.stringify(next));
    Object.assign(tx, next);
  }
  async list() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return (await readdir(this.root)).filter(id => /^[a-f0-9-]{36}$/.test(id));
  }
  async digest(root: string) { return `sha256:${await packageDigest(root, (await inspectPackage(root)).files)}`; }
  async verifyCandidate(tx: UpdateTransaction) {
    if (await this.digest(this.candidate(tx.operationId)) !== tx.descriptor.packageDigest) throw new Error("APP_UPDATE_PACKAGE_CHANGED");
  }
  async prepareBuild(tx: UpdateTransaction) {
    const root = this.build(tx.operationId);
    await removePackageArtifact(root);
    await copyPackage(this.candidate(tx.operationId), root);
    await writable(root);
    return root;
  }
  backup(source: string, id: string) { this.operation(id); return join(dirname(source), `.${basename(source)}.update-${id}.backup`); }
  async synchronize(tx: UpdateTransaction, source: string, publishedSource: string, checkpoint: (phase: string) => Promise<void>) {
    const backup = this.backup(source, tx.operationId), staged = `${backup}.next`;
    const hasBackup = await exists(backup), hasSource = await exists(source);
    if (hasBackup && hasSource && !await exists(staged)) {
      // Both renames committed. Check the exact source before acknowledging a previous crash.
      if (await this.digest(source) !== await this.digest(publishedSource)) throw new Error("APP_UPDATE_SOURCE_CHANGED");
      return;
    }
    if (!hasBackup) {
      if (!hasSource || await this.digest(source) !== tx.sourceDigest) throw new Error("APP_UPDATE_SOURCE_CHANGED");
      await removePackageArtifact(staged);
      await cp(publishedSource, staged, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      await writable(staged);
      await durableTree(staged);
      if (await this.digest(source) !== tx.sourceDigest) throw new Error("APP_UPDATE_SOURCE_CHANGED");
      await rename(source, backup); await syncDirectory(dirname(source));
      await checkpoint("source-backed-up");
    }
    if (await exists(source)) throw new Error("APP_UPDATE_SOURCE_CHANGED");
    if (!await exists(staged)) throw new Error("APP_UPDATE_STAGED_SOURCE_MISSING");
    if (await this.digest(staged) !== await this.digest(publishedSource)) throw new Error("APP_UPDATE_PACKAGE_CHANGED");
    await rename(staged, source); await syncDirectory(dirname(source));
    await checkpoint("source-published");
  }
  async cleanup(tx: UpdateTransaction) { await removePackageArtifact(this.operation(tx.operationId)); await syncDirectory(this.root); }
}
async function exists(path: string) {
  try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("APP_UPDATE_DIRECTORY_INVALID"); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function writable(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await writable(path); else if (entry.isFile()) await chmod(path, 0o600); else throw new Error("APP_UPDATE_SOURCE_INVALID");
  }
}
async function durableTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await durableTree(path);
    else if (entry.isFile()) { const { open } = await import("node:fs/promises"), handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
    else throw new Error("APP_UPDATE_SOURCE_INVALID");
  }
  await syncDirectory(root);
}
