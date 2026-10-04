/**
 * [INPUT]: Depends on Node fs/promises and path, and the RuntimeIdentity (realpath, dev, ino, mtime, size) the registry reads around every version probe.
 * [OUTPUT]: Provides configureRuntimeVersionCache(file) and cachedRuntimeVersion(backend, executable, identity, probe): a version answered before for the very same file spares the first `--version` of a launch; later checks in the same process probe again.
 * [POS]: Side module of runtime-registry.ts (kept out of it for its 800-line bound); C-10 — each `--version` is a CLI process of up to ~200 MB at the most contended moment of a launch.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RuntimeIdentity } from "./availability/runtime";

const LIMIT = 64;
let file: string | null = null;
let loaded: Promise<Map<string, string>> = Promise.resolve(new Map());
let writing: Promise<void> = Promise.resolve();
/* A remembered answer spares the launch probe, once per file per process. Every later check (a Recheck, a periodic
   one) asks the CLI again: a binary that stops answering without changing on disk must still be caught. */
const served = new Set<string>();

/* Everything that would change what `--version` prints is in the key: another file, a replaced file (new inode or
   mtime), or the same path upgraded in place. A reinstall that keeps all five is the same bytes for this purpose. */
const keyOf = (backend: string, executable: string, identity: RuntimeIdentity) =>
  [backend, executable, identity.realpath, identity.dev, identity.ino, identity.mtimeMs, identity.size].join("\0");

export function configureRuntimeVersionCache(path: string | null) {
  file = path;
  loaded = path ? readFile(path, "utf8").then((text) => {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return new Map<string, string>();
    return new Map(value.filter((entry): entry is [string, string] =>
      Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string").slice(-LIMIT));
  }).catch(() => new Map<string, string>()) : Promise.resolve(new Map());
}

export async function cachedRuntimeVersion(backend: string, executable: string, identity: RuntimeIdentity | undefined,
  probe: () => Promise<string | undefined>) {
  if (!identity) return probe();
  const entries = await loaded, key = keyOf(backend, executable, identity);
  const known = entries.get(key);
  if (known && !served.has(key)) { served.add(key); return known; }
  served.add(key);
  const version = await probe();
  /* Only an answer is remembered, and a failed or unparseable probe forgets the old one: the next launch must ask again. */
  entries.delete(key);
  if (version) {
    entries.set(key, version);
    while (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
  }
  if (version || known) persist(entries);
  return version;
}

/* A cache, never a fact: a failed write costs the next launch one probe, so it is swallowed. */
function persist(entries: Map<string, string>) {
  const target = file;
  if (!target) return;
  writing = writing.then(async () => {
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify([...entries]), { mode: 0o600 });
    await rename(temporary, target);
  }).catch(() => undefined);
}
