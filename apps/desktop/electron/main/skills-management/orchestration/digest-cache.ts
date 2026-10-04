/**
 * [INPUT]: Depends on Node fs/crypto and the per-file stats the Skill folder walk already collects
 * [OUTPUT]: Provides SkillDigestCache, SkillFileStat and the bounded SkillDigestCacheStore backed by one JSON file under userData
 * [POS]: skills-management discovery accelerator consumed by package.ts; it answers "same bytes as last time", never "these bytes are trustworthy"
 */

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

export type SkillFileStat = Readonly<{
  path: string;
  bytes: number;
  mtimeMs: number;
}>;

export type SkillDigest = `sha256:${string}`;

export type SkillDigestCache = Readonly<{
  lookup(canonicalPath: string, files: readonly SkillFileStat[]): SkillDigest | undefined;
  remember(canonicalPath: string, files: readonly SkillFileStat[], digest: SkillDigest): void;
}>;

/* ── Why a cache at all ───────────────────────────────────────────────────
 * Discovery sha256s every byte of every Skill folder under five Agent homes on
 * each refresh: 80 MB of reads and ~300 ms of main thread for a result that is
 * identical to the previous launch's in all but the rarest case. The folder's
 * (path, size, mtime) listing already proves "nothing was written here", and
 * that listing is a by-product of the walk the inspection performs regardless.
 *
 * The cache is therefore an answer to "did this change", never to "is this
 * safe". Import-time verification hashes real bytes and is never given a cache,
 * so a forged cache file can at most cause a stale candidate listing that the
 * next real hash rejects.
 * ───────────────────────────────────────────────────────────────────────── */
const MAX_ENTRIES = 2_000;
const FILE_VERSION = 1;

type StoredEntry = readonly [path: string, signature: string, digest: SkillDigest];

export class SkillDigestCacheStore implements SkillDigestCache {
  /* Insertion order is the LRU order: a hit re-inserts, an overflow drops the front. */
  private readonly entries = new Map<string, { signature: string; digest: SkillDigest }>();
  private loading: Promise<void> | undefined;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  /** Idempotent; a missing, unreadable or corrupt file simply starts the cache empty. */
  ready() {
    this.loading ??= this.load();
    return this.loading;
  }

  lookup(canonicalPath: string, files: readonly SkillFileStat[]) {
    const entry = this.entries.get(canonicalPath);
    if (!entry || entry.signature !== signatureOf(files)) return undefined;
    this.entries.delete(canonicalPath);
    this.entries.set(canonicalPath, entry);
    return entry.digest;
  }

  remember(canonicalPath: string, files: readonly SkillFileStat[], digest: SkillDigest) {
    this.entries.delete(canonicalPath);
    this.entries.set(canonicalPath, { signature: signatureOf(files), digest });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.dirty = true;
  }

  /** Best-effort persistence: a cache that cannot be written only costs the next scan. */
  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const payload: readonly StoredEntry[] = [...this.entries].map(
      ([path, entry]) => [path, entry.signature, entry.digest] as const
    );
    const temporary = `${this.filePath}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: FILE_VERSION, entries: payload }),
        { mode: 0o600 }
      );
      await rename(temporary, this.filePath);
    } catch {
      this.dirty = true;
    }
  }

  private async load() {
    const parsed = await readFile(this.filePath, "utf8")
      .then((content) => JSON.parse(content) as unknown)
      .catch(() => null);
    const entries =
      parsed && typeof parsed === "object" && (parsed as { version?: unknown }).version === FILE_VERSION
        ? (parsed as { entries?: unknown }).entries
        : undefined;
    if (!Array.isArray(entries)) return;
    for (const entry of entries.slice(-MAX_ENTRIES)) {
      if (!Array.isArray(entry) || entry.length !== 3) continue;
      const [path, signature, digest] = entry as unknown[];
      if (typeof path !== "string" || typeof signature !== "string") continue;
      if (typeof digest !== "string" || !digest.startsWith("sha256:")) continue;
      this.entries.set(path, { signature, digest: digest as SkillDigest });
    }
  }
}

/* The listing itself is the key, but storing it whole would make the cache file
   grow with the biggest Skill anyone owns; its hash decides the same question. */
function signatureOf(files: readonly SkillFileStat[]) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file.path}\0${file.bytes}\0${file.mtimeMs}\n`, "utf8");
  }
  return hash.digest("hex");
}
