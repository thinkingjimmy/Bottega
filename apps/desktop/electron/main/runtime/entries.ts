/**
 * [INPUT]: Depends on node:crypto/fs/path and the runtime model (entries manifest schema, LaunchRefused).
 * [OUTPUT]: Provides EntryCatalog: the real on-disk path of a Bottega entry (unpacked `out/main/<file>`) or an adapter package's entry file (unpacked `node_modules`), each verified against the build's digest before it is handed out, by its canonical (real) path; the digest is re-computed whenever the file's identity (device, inode, size, mtime or ctime) changes. It also hands out a built-in Provider package's pins (its directory and its files' digests), which the bundled admission verifies.
 * [POS]: The runtime port's program catalog (TASK-35 §2.4). Paths point outside the asar (`app.asar.unpacked`), where a plain Node can read them.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { entriesManifestSchema, LaunchRefused, type EntriesManifest, type NodeEntry, type NodePackage } from "./model";

/** A packed asar path's unpacked twin; a path outside any asar is returned as is. */
export const unpacked = (path: string) => path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`).replace(/[/\\]app\.asar$/, `${sep}app.asar.unpacked`);

export class EntryCatalog {
  private manifest: EntriesManifest | null = null;
  /* ctime is in the key: restoring mtime with utimes cannot hide a rewrite, because the rewrite itself moves ctime. */
  private readonly verifiedAt = new Map<string, string>();
  constructor(private readonly mainDirectory: string) {}

  entryPath(entry: NodeEntry) {
    const record = this.read().entries[entry];
    if (!record) throw new LaunchRefused("entry-missing", `No runtime entry ${entry} was built.`);
    return this.verify(join(unpacked(this.mainDirectory), record.file), record.sha256);
  }
  packagePath(name: NodePackage) {
    const record = this.read().packages[name];
    if (!record) throw new LaunchRefused("package-unknown", `No adapter package ${name} is recorded.`);
    return this.verify(join(unpacked(join(this.mainDirectory, "..", "..")), record.path), record.sha256);
  }

  /** A built-in Provider package's pins (TASK-11 d3): its directory inside the build (an Electron utility process reads the asar) and
      each file's digest; extensions/host/bundled-providers.ts verifies every byte against them before admitting the package. */
  providerPackage(providerId: string) {
    const record = this.read().providerPackages?.[providerId];
    if (!record) throw new LaunchRefused("entry-missing", `No Provider package for ${providerId} was built.`);
    return { root: join(this.mainDirectory, record.directory), files: record.files };
  }

  private read() {
    if (!this.manifest) {
      const path = join(this.mainDirectory, "runtime-entries.json");
      if (!existsSync(path)) throw new LaunchRefused("entry-missing", `The runtime entries manifest is missing at ${path}.`);
      this.manifest = entriesManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    }
    return this.manifest;
  }
  /* The canonical path is handed out: a sandbox admits a program by its real directory, and development's pnpm node_modules are links. */
  private verify(requested: string, sha256: string) {
    if (!existsSync(requested)) throw new LaunchRefused("entry-missing", `The runtime program ${requested} is missing.`);
    const path = realpathSync(requested);
    const info = statSync(path, { bigint: true });
    const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    if (this.verifiedAt.get(path) === identity) return path;
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== sha256) {
      this.verifiedAt.delete(path);
      throw new LaunchRefused("entry-digest-mismatch", `The runtime program ${path} does not match its recorded digest.`);
    }
    this.verifiedAt.set(path, identity);
    return path;
  }
}
