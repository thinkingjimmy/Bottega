/**
 * [INPUT]: Depends on proven Home ownership, exact source fingerprints, independent frozen-file clones and its own retained-evidence sidecar.
 * [OUTPUT]: Reuses unchanged bytes across restarts from durable fingerprint evidence without changing outbox or receipt truth.
 * [POS]: Bounded per-Home optimization; cache cleanup cannot remove original snapshots or recovery-owned files.
 */
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { blobDescriptorSchema, type BlobDescriptor } from "@ai-chat/cloud-protocol";
import { MAX_HOME_ENTRIES } from "@ai-chat/cloud-protocol/chats/home/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { HomeFile } from "../scan";
import { cloneHomeBytes } from "./clone";
import { fileFingerprint, openHomeFile } from "./identity";

type Retained = { blob: BlobDescriptor; sourceIdentity: string; retainedIdentity: string };
type Evidence = { entries: Map<string, Retained>; directoryIdentity: string };
const evidence = new Map<string, Evidence>();
const flights = new Map<string, Promise<void>>();
const SIDECAR = "reuse.json";
const cacheName = /^([a-f0-9]{64}\.bin|\.part-[a-f0-9-]{36}|reuse\.json)$/;
const identity = z.string().min(1).max(256);
const sidecarSchema = z.object({ directoryIdentity: identity,
  entries: z.array(z.tuple([z.string().min(1).max(1024),
    z.object({ blob: blobDescriptorSchema, sourceIdentity: identity, retainedIdentity: identity }).strict()])).max(MAX_HOME_ENTRIES),
}).strict();

export class HomeReuseCache {
  private readonly root: string;
  private readonly next = new Map<string, Retained>();
  private previous = new Map<string, Retained>();
  private directoryIdentity = "";

  constructor(parent: string, identity: unknown) { this.root = join(parent, `.reuse-${hashChatContent(identity)}`); }

  keepPrevious() { for (const [path, retained] of this.previous) this.next.set(path, retained); }

  async use<T>(body: (cache: HomeReuseCache) => Promise<T>) {
    const previous = flights.get(this.root) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    flights.set(this.root, held);
    await previous;
    try { await this.initialize(); const result = await body(this); await this.finish(); return result; }
    finally { release(); if (flights.get(this.root) === held) flights.delete(this.root); }
  }

  private async initialize() {
    await mkdir(this.root, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
    const stat = await lstat(this.root, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(this.root) !== this.root) throw new Error("HOME_SOURCE_DIRECTORY_CHANGED");
    this.directoryIdentity = `${stat.dev}:${stat.ino}`;
    const saved = evidence.get(this.root);
    if (saved?.directoryIdentity === this.directoryIdentity) this.previous = saved.entries;
    else this.previous = await this.saved();
    evidence.delete(this.root);
  }

  /* Fingerprints are durable values, so the evidence outlives this process: without it every restart
     re-reads, re-hashes and re-copies the whole Home. Anything unreadable falls back to full verification,
     and `reuse` still re-verifies both the source and the retained copy before trusting an entry. */
  private async saved() {
    let file: Awaited<ReturnType<typeof open>>;
    try { file = await open(join(this.root, SIDECAR), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch { return new Map<string, Retained>(); }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) return new Map<string, Retained>();
      const value = sidecarSchema.parse(JSON.parse(await file.readFile("utf8")));
      return value.directoryIdentity === this.directoryIdentity ? new Map(value.entries) : new Map<string, Retained>();
    } catch { return new Map<string, Retained>(); }
    finally { await file.close(); }
  }

  async reuse(root: string, file: HomeFile, target: (blob: BlobDescriptor) => string, signal: AbortSignal) {
    const retained = this.previous.get(file.path);
    if (!file.reusable || !retained || retained.sourceIdentity !== file.identity) return null;
    const source = await openHomeFile(root, file), cached = join(this.root, `${retained.blob.sha256}.bin`);
    const temporary = join(dirname(target(retained.blob)), `.part-${randomUUID()}`);
    try {
      let fingerprint: string;
      try { fingerprint = fileFingerprint(await lstat(cached, { bigint: true })); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as Error).message === "HOME_SOURCE_CHANGED") return null; throw error; }
      if (fingerprint !== retained.retainedIdentity || !await cloneHomeBytes(cached, temporary, fingerprint, signal)) return null;
      await source.verify(); signal.throwIfAborted();
      await rename(temporary, target(retained.blob));
      this.next.set(file.path, retained); return retained.blob;
    } finally { await source.handle.close(); await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }

  async retain(file: HomeFile, blob: BlobDescriptor, frozen: string, signal: AbortSignal) {
    if (!file.reusable) return;
    const temporary = join(this.root, `.part-${randomUUID()}`), target = join(this.root, `${blob.sha256}.bin`);
    try {
      const duplicate = [...this.next.values()].find(value => value.blob.sha256 === blob.sha256);
      if (duplicate && fileFingerprint(await lstat(target, { bigint: true })) === duplicate.retainedIdentity) {
        this.next.set(file.path, { ...duplicate, sourceIdentity: file.identity }); return;
      }
      const original = fileFingerprint(await lstat(frozen, { bigint: true }));
      if (!await cloneHomeBytes(frozen, temporary, original, signal)) return;
      await rename(temporary, target);
      const retainedIdentity = fileFingerprint(await lstat(target, { bigint: true }));
      this.next.set(file.path, { blob, sourceIdentity: file.identity, retainedIdentity });
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }

  private async finish() {
    const stat = await lstat(this.root, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || `${stat.dev}:${stat.ino}` !== this.directoryIdentity || await realpath(this.root) !== this.root) {
      throw new Error("HOME_SOURCE_DIRECTORY_CHANGED");
    }
    const retained = new Set([...this.next.values()].map(value => `${value.blob.sha256}.bin`));
    for (const file of await readdir(this.root, { withFileTypes: true })) {
      if (!file.isFile() || !cacheName.test(file.name)) throw new Error("HOME_SOURCE_DIRECTORY_CHANGED");
      if (!retained.has(file.name)) await unlink(join(this.root, file.name));
    }
    if (this.next.size) await this.persist();
    const directory = await open(this.root, "r"); try { await directory.sync(); } finally { await directory.close(); }
    evidence.set(this.root, { entries: this.next, directoryIdentity: this.directoryIdentity });
    // Eviction discards only optimization evidence; owned cache bytes are replaced on that Home's next capture.
    if (evidence.size > 32) evidence.delete(evidence.keys().next().value!);
  }

  // A sidecar that cannot be written costs the next capture its reuse, never the snapshot it just froze.
  private async persist() {
    const temporary = join(this.root, `.part-${randomUUID()}`);
    try {
      const value = sidecarSchema.parse({ directoryIdentity: this.directoryIdentity, entries: [...this.next] });
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.root, SIDECAR));
      // Optimization evidence only: a failure here must leave the frozen snapshot and its cached bytes untouched.
    } catch { await unlink(temporary).catch(() => {}); }
  }
}
