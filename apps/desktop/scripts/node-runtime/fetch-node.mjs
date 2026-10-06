#!/usr/bin/env node
/**
 * [INPUT]: Depends on node:crypto/fs/child_process, the system tar (xz), nodejs.org release files, and release-verifier.mjs (openpgp.js with the keys pinned from nodejs/release-keys) unless a verifier is passed.
 * [OUTPUT]: Provides fetchNodeRuntime (download, verify the SHASUMS signature and the tarball digest, extract exactly bin/node and LICENSE into a user-level cache keyed by the tarball digest, under a lock published whole and reclaimed only through a tombstone rename), resolveNodeRuntime (re-check the cached binary's digest on use), manifestNodeSection, writeManifestNodeSection, writeOfflineManifest (`--offline`: the dev manifest from a verified cache only, never the network), and a CLI (`--dev-manifest` for the fixed apps/desktop/runtime-manifest.dev.json, or `--manifest <path>`).
 * [POS]: The one fetch-and-verify step for the bundled Node, shared by TASK-35's dev/E2E setup and TASK-34's packaging pipeline; build tooling only — the packaged app never reads this cache or BOTTEGA_RUNTIME_CACHE.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openpgpVerifier, pinnedReleaseKeys } from "./release-verifier.mjs";

const SCRIPT = "node apps/desktop/scripts/node-runtime/fetch-node.mjs";
/** One pin per approved artifact: a new version or platform needs its own approval and its own line here. */
const PINS = { "24.18.0": { "darwin-arm64": { tarball: "node-v24.18.0-darwin-arm64.tar.xz",
  sha256: "4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6" } } };
const LOCK_STALE_MS = 10 * 60_000, LOCK_GRACE_MS = 30_000, LOCK_POLL_MS = 100;
const run = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

export class NodeRuntimeUnavailable extends Error { constructor(message) { super(message); this.name = "NodeRuntimeUnavailable"; } }

/** Dev/E2E/CI only. The path has spaces on macOS: it is only ever passed as an argument, never through a shell. */
export function defaultCacheRoot(env = process.env) {
  if (env.BOTTEGA_RUNTIME_CACHE) return env.BOTTEGA_RUNTIME_CACHE;
  return process.platform === "darwin" ? join(homedir(), "Library", "Caches", "Bottega Dev Runtime")
    : join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "bottega-dev-runtime");
}
export function pinFor(version, platform, arch) {
  const pin = PINS[version]?.[`${platform}-${arch}`];
  if (!pin) throw new Error(`There is no pinned Node ${version} for ${platform}-${arch}; add an approved pin before fetching it.`);
  return pin;
}

const layout = ({ cacheRoot = defaultCacheRoot(), pin }) => {
  const root = join(cacheRoot, "node"), final = join(root, pin.sha256);
  return { root, final, name: pin.sha256, lock: join(root, `.${pin.sha256}.lock`), staging: join(root, `.${pin.sha256}.staging-${process.pid}`),
    download: join(root, `.${pin.sha256}.download-${process.pid}.tar.xz`), meta: join(final, "node-runtime.json") };
};
const describe = ({ version = "24.18.0", platform = "darwin", arch = "arm64" }) => `Node ${version} ${platform}-${arch}`;

/** Re-checks the cached binary against the digest recorded when it was verified; never falls back to another Node. */
export async function resolveNodeRuntime(options = {}) {
  const { version = "24.18.0", platform = "darwin", arch = "arm64" } = options;
  const pin = options.pin ?? pinFor(version, platform, arch), paths = layout({ ...options, pin });
  const meta = await readFile(paths.meta, "utf8").then(JSON.parse, () => null);
  if (!meta) throw new NodeRuntimeUnavailable(`The pinned ${describe(options)} is not in the cache (${paths.final}). Run: ${SCRIPT}`);
  const binary = join(paths.final, "bin", "node"), license = join(paths.final, "LICENSE");
  const bytes = await readFile(binary).catch(() => null);
  if (meta.version !== version || meta.platform !== platform || meta.arch !== arch || !bytes || sha256(bytes) !== meta.sha256 || !existsSync(license))
    throw new NodeRuntimeUnavailable(`The cached ${describe(options)} has changed since it was verified (${binary}). Run: ${SCRIPT}`);
  return { ...meta, binary, license };
}

const readOwner = async (lock) => {
  const text = await readFile(join(lock, "owner.json"), "utf8").catch(() => null);
  try { const owner = text === null ? null : JSON.parse(text); return owner && Number.isInteger(owner.pid) && Number.isFinite(owner.at) ? owner : null; }
  catch { return null; }
};
const unique = () => `${process.pid}-${randomBytes(6).toString("hex")}`;

/**
 * One lock per tarball digest (B3-01). A lock appears only by one rename of a complete directory (owner inside), so nobody
 * reads a half-written owner. An owner that cannot be read is unknown: the lock is stale only past the grace period. A stale
 * lock is reclaimed by renaming it to a unique tombstone; only the contender whose rename moved the lock it judged wins, and
 * one that moved a fresher lock puts it back. Returns the lock's nonce, or "published" when the cache appeared meanwhile.
 */
async function acquire(paths, { staleMs, graceMs, pollMs }) {
  await mkdir(paths.root, { recursive: true });
  for (;;) {
    if (existsSync(paths.meta)) return "published";
    if (!existsSync(paths.lock)) {
      const nonce = unique(), temporary = join(paths.root, `.${paths.name}.lock-${nonce}`);
      await mkdir(temporary);
      await writeFile(join(temporary, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now(), nonce }));
      try { await rename(temporary, paths.lock); return nonce; }
      catch (error) {
        await rm(temporary, { recursive: true, force: true });
        if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(error.code)) throw error;
      }
      continue;
    }
    const owner = await readOwner(paths.lock), age = await lstat(paths.lock).then(info => Date.now() - info.mtimeMs, () => null);
    if (age === null) continue; // released or reclaimed while we looked
    const stale = owner ? !alive(owner.pid) || Date.now() - owner.at > staleMs : age > graceMs;
    if (!stale) { await new Promise(resolve => setTimeout(resolve, pollMs)); continue; }
    const tombstone = join(paths.root, `.${paths.name}.tomb-${unique()}`);
    try { await rename(paths.lock, tombstone); } catch { continue; } // another contender reclaimed it first
    const moved = await readOwner(tombstone);
    if ((moved?.nonce ?? null) !== (owner?.nonce ?? null) || (moved === null) !== (owner === null)) {
      // We moved a lock published after our judgement: give it back when its place is still free.
      await rename(tombstone, paths.lock).catch(() => undefined);
    }
    await rm(tombstone, { recursive: true, force: true });
  }
}
const holds = async (paths, nonce) => (await readOwner(paths.lock))?.nonce === nonce;
async function release(paths, nonce) {
  if (!(await holds(paths, nonce))) return; // a lock we no longer hold is someone else's
  const tombstone = join(paths.root, `.${paths.name}.tomb-${unique()}`);
  await rename(paths.lock, tombstone).catch(() => undefined);
  const moved = await readOwner(tombstone);
  if (moved && moved.nonce !== nonce) await rename(tombstone, paths.lock).catch(() => undefined);
  await rm(tombstone, { recursive: true, force: true });
}
async function clearStale(paths, pin) {
  for (const name of await readdir(paths.root)) {
    // Staging, downloads, unpublished lock drafts and tombstones of a process that is gone.
    const match = new RegExp(`^\\.${pin.sha256}\\.(?:staging-(\\d+)|download-(\\d+)\\.tar\\.xz|(?:lock|tomb)-(\\d+)-[0-9a-f]+)$`).exec(name);
    if (match && !alive(Number(match[1] ?? match[2] ?? match[3]))) await rm(join(paths.root, name), { recursive: true, force: true });
  }
}
async function verifySums({ files, verifier, keys, pin }) {
  const { text, fingerprint } = await verifier.verify(files.asc.toString("utf8"), keys);
  // A cleartext signature drops the text's final line ending; the file may carry exactly that one newline more.
  const unsigned = files.sums.toString("utf8");
  if (unsigned !== text && unsigned !== text + "\n") throw new Error("SHASUMS256.txt differs from its signed text.");
  const lines = text.split("\n").filter(line => line.endsWith(`  ${pin.tarball}`));
  const line = lines.length === 1 && /^([0-9a-f]{64}) {2}/.exec(lines[0])?.[1];
  if (!line) throw new Error(`Expected exactly one SHASUMS256 line for ${pin.tarball}, found ${lines.length}.`);
  if (line !== pin.sha256) throw new Error(`The signed SHASUMS256 digest for ${pin.tarball} is not the pinned one.`);
  if (sha256(files.tarball) !== line) throw new Error(`${pin.tarball} does not match the signed SHASUMS256.`);
  return fingerprint;
}
/** Exactly bin/node and LICENSE, by name, each a regular file; the tar gets an argument array, so spaces are safe. */
async function extract(paths, pin, tarball) {
  const top = pin.tarball.replace(/\.tar\.xz$/, ""), unpack = join(paths.staging, "unpack");
  await mkdir(unpack, { recursive: true });
  await writeFile(paths.download, tarball);
  try { await run("/usr/bin/tar", ["-xJf", paths.download, "-C", unpack, `${top}/bin/node`, `${top}/LICENSE`]); }
  catch { throw new Error(`${pin.tarball} does not contain both bin/node and LICENSE.`); }
  for (const name of ["bin/node", "LICENSE"]) {
    const entry = await lstat(join(unpack, top, name));
    if (!entry.isFile()) throw new Error(`${name} in ${pin.tarball} is not a regular file.`);
  }
  await mkdir(join(paths.staging, "bin"));
  await rename(join(unpack, top, "bin", "node"), join(paths.staging, "bin", "node"));
  await rename(join(unpack, top, "LICENSE"), join(paths.staging, "LICENSE"));
  await rm(unpack, { recursive: true, force: true });
  await chmod(join(paths.staging, "bin", "node"), 0o755);
}

export async function fetchNodeRuntime(options = {}) {
  const { version = "24.18.0", platform = "darwin", arch = "arm64" } = options;
  const verifier = options.verifier ?? openpgpVerifier(), keys = options.keys ?? await pinnedReleaseKeys();
  const pin = options.pin ?? pinFor(version, platform, arch), paths = layout({ ...options, pin });
  const download = options.download ?? (async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  });
  const verified = await resolveNodeRuntime({ ...options, pin }).catch(() => null);
  if (verified) return verified;
  // Nothing is downloaded that could not be verified: no pinned key, no network.
  if (!keys.length) throw new Error("No Node release key is pinned (scripts/node-runtime/release-keys.json); nothing is fetched that could not be verified.");
  const timing = { staleMs: options.lockStaleMs ?? LOCK_STALE_MS, graceMs: options.lockGraceMs ?? LOCK_GRACE_MS, pollMs: options.lockPollMs ?? LOCK_POLL_MS };
  const nonce = await acquire(paths, timing);
  if (nonce === "published") return resolveNodeRuntime({ ...options, pin });
  try {
    if (existsSync(paths.meta)) {
      const reused = await resolveNodeRuntime({ ...options, pin }).catch(() => null);
      if (reused) return reused;
      await rm(paths.final, { recursive: true, force: true }); // corrupt: this script is the repair
    }
    await clearStale(paths, pin);
    // A holder whose lock was reclaimed (it looked stale) starts over instead of downloading beside the new holder.
    if (!(await holds(paths, nonce))) return fetchNodeRuntime(options);
    const base = `https://nodejs.org/dist/v${version}/`;
    const [tarball, sums, asc] = await Promise.all([pin.tarball, "SHASUMS256.txt", "SHASUMS256.txt.asc"].map(name => download(base + name)));
    const signer = await verifySums({ files: { tarball, sums, asc }, verifier, keys, pin });
    await rm(paths.staging, { recursive: true, force: true });
    await extract(paths, pin, tarball);
    const binary = await readFile(join(paths.staging, "bin", "node"));
    const meta = { version, platform, arch, sha256: sha256(binary), bytes: (await stat(join(paths.staging, "bin", "node"))).size,
      source: { tarball: pin.tarball, sha256: pin.sha256, releaseSignature: "verified", signer } };
    await writeFile(join(paths.staging, "node-runtime.json"), JSON.stringify(meta, null, 2) + "\n");
    await rename(paths.staging, paths.final); // the only way a cache directory appears: complete and verified
    return resolveNodeRuntime({ ...options, pin });
  } finally {
    await rm(paths.staging, { recursive: true, force: true });
    await rm(paths.download, { force: true });
    await release(paths, nonce);
  }
}

/* The dev manifest is generated and Git-ignored: scripts ask for it by flag, never by naming the file. */
const DEV_MANIFEST = fileURLToPath(new URL("../../runtime-manifest.dev.json", import.meta.url));
const ONLINE = `${SCRIPT} --dev-manifest`;
/**
 * `--offline`, for build:e2e: the dev manifest comes only from a cache that verifies now; nothing is fetched.
 * Any cache problem is one line that ends with the online command, and the manifest is left as it was.
 */
export async function writeOfflineManifest({ manifest, ...options }) {
  const node = await resolveNodeRuntime(options).catch(error => {
    throw new NodeRuntimeUnavailable(`${error.message.replace(/ Run: .*$/, "")} Run: ${ONLINE}`);
  });
  await writeManifestNodeSection(manifest, node, { binary: node.binary });
  return node;
}

/** The manifest's `node` section, the one shape the runtime port reads (runtime/model.ts); shared with after-pack.mjs. */
export function manifestNodeSection({ version, platform, arch, sha256: digest, bytes, source }, { binary } = {}) {
  return { version, platform, arch, sha256: digest, bytes, source, ...(binary ? { binary } : {}) };
}

/**
 * Replaces only the manifest's `node` section; `entries` and `packages` belong to the foundation's build step. A dev
 * manifest also names the verified cache binary, so main reads a manifest and never BOTTEGA_RUNTIME_CACHE; the packaged
 * manifest has no `binary` (its Node sits at a fixed place in Resources).
 */
export async function writeManifestNodeSection(manifestPath, node, { binary } = {}) {
  const current = await readFile(manifestPath, "utf8").then(JSON.parse, () => ({}));
  const next = { ...current, node: manifestNodeSection(node, { binary }) };
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2) + "\n");
  await rename(temporary, manifestPath);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argument = (name) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : undefined; };
  const manifestPath = () => process.argv.includes("--dev-manifest") ? DEV_MANIFEST : argument("manifest");
  const options = { platform: argument("platform") ?? "darwin", arch: argument("arch") ?? "arm64" };
  try {
    if (process.argv.includes("--offline")) {
      const manifest = manifestPath();
      if (!manifest) throw new Error(`--offline needs --dev-manifest or --manifest <path>. Run: ${ONLINE}`);
      const node = await writeOfflineManifest({ ...options, manifest });
      process.stdout.write(`${node.binary}\n`);
      process.exit(0);
    }
    const node = await fetchNodeRuntime(options);
    const manifest = manifestPath();
    // The CLI serves development and E2E: its manifest is the dev one, next to out/.
    if (manifest) await writeManifestNodeSection(manifest, node, { binary: node.binary });
    process.stdout.write(`${node.binary}\n${node.sha256}  bin/node (${node.bytes} bytes, from ${node.source.tarball}, signed by ${node.source.signer})\n`);
  } catch (error) { process.stderr.write(`[fetch-node] ${error.message}\n`); process.exitCode = 1; }
}
