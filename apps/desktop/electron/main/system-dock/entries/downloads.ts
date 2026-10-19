/**
 * [INPUT]: Depends on Node fs/path/crypto, injected shell and visual loaders, and pathless Downloads contracts.
 * [OUTPUT]: Provides bounded Downloads listing, stable short-lived references, verified open/reveal, and four-at-a-time visibility-scoped visual caching.
 * [POS]: system-dock/entries Downloads authority; verifies file identity and contents metadata before and after native preview work and never exposes paths.
 */

import { randomBytes } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import type { DownloadEntry, DownloadsDetail, DownloadVisual, DownloadVisualRequest } from "../../../../shared/system-dock/ipc";

export const DOWNLOADS_LIMITS = { visible: 20, scan: 2_000, concurrency: 16, timeoutMs: 5_000, refTtlMs: 5 * 60_000, debounceMs: 500 } as const;
const PACKAGE_EXTENSIONS = new Set([".app", ".bundle", ".pkg", ".mpkg", ".framework", ".plugin", ".kext", ".xcodeproj", ".playground", ".rtfd", ".pages", ".numbers", ".key"]);
type Ref = { path: string; dev: number; ino: number; mtime: number; size: number; kind: DownloadEntry["kind"]; expiresAt: number };
export type ShellPort = { openPath(path: string): Promise<string>; showItemInFolder?(path: string): void | Promise<void> };
type VisualLoader = (path: string, size: DownloadVisualRequest["size"], regularFile: boolean) => Promise<DownloadVisual | null>;

export class DownloadsEntry {
  private detail: DownloadsDetail = { state: "loading", entries: [] };
  private refs = new Map<string, Ref>();
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private flight: Promise<void> | null = null;
  private visible = false;
  private visuals = new Map<string, Promise<DownloadVisual | null>>();
  private visualActive = 0;
  private visualWaiters: (() => void)[] = [];
  constructor(private readonly shell: ShellPort, private readonly changed: () => void, readonly directory = join(homedir(), "Downloads"), private readonly now = Date.now) {}
  snapshot(): DownloadsDetail { return this.detail; }
  /** A visible Downloads detail is the only consumer; hiding stops watching and forgets references. */
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) { this.generation++; this.watcher?.close(); this.watcher = null; if (this.timer) clearTimeout(this.timer); this.timer = null; this.refs.clear(); this.visuals.clear(); return; }
    void this.refresh();
    try {
      this.watcher = watch(this.directory, { persistent: false }, () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, DOWNLOADS_LIMITS.debounceMs);
      });
      this.watcher.on("error", () => { this.watcher?.close(); this.watcher = null; });
    } catch { /* the listing reports denied/missing; the Finder exit still works */ }
  }
  refresh(): Promise<void> {
    if (this.flight) return this.flight;
    const generation = this.generation;
    this.flight = this.scan(generation).finally(() => {
      this.flight = null;
      if (this.visible && generation !== this.generation) void this.refresh();
    });
    return this.flight;
  }
  private async scan(generation: number) {
    const deadline = this.now() + DOWNLOADS_LIMITS.timeoutMs;
    const names: string[] = [];
    let partial = false;
    try {
      const directory = await opendir(this.directory, { bufferSize: 64 });
      try {
        for await (const entry of directory) {
          if (entry.name.startsWith(".")) continue;
          names.push(entry.name);
          if (names.length >= DOWNLOADS_LIMITS.scan || this.now() > deadline) { partial = true; break; }
        }
      } finally { await directory.close().catch(() => undefined); }
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      this.publish(generation, { state: code === "ENOENT" ? "missing" : code === "EPERM" || code === "EACCES" ? "denied" : "error", entries: [] }, new Map());
      return;
    }
    const stats: { name: string; dev: number; ino: number; mtime: number; size: number; kind: DownloadEntry["kind"] }[] = [];
    for (let index = 0; index < names.length; index += DOWNLOADS_LIMITS.concurrency) {
      if (this.now() > deadline) { partial = true; break; }
      const batch = await Promise.all(names.slice(index, index + DOWNLOADS_LIMITS.concurrency).map(async (name) => {
        try {
          const info = await lstat(join(this.directory, name));
          const kind: DownloadEntry["kind"] = info.isDirectory() ? (PACKAGE_EXTENSIONS.has(extname(name).toLowerCase()) ? "package" : "directory") : "file";
          return { name, dev: info.dev, ino: info.ino, mtime: info.mtimeMs, size: info.isFile() ? info.size : 0, kind };
        } catch { partial = true; return null; }
      }));
      for (const value of batch) if (value) stats.push(value);
    }
    stats.sort((a, b) => b.mtime - a.mtime);
    const refs = new Map<string, Ref>();
    const previous = new Map([...this.refs].map(([ref, value]) => [value.path, { ref, value }]));
    const entries = stats.slice(0, DOWNLOADS_LIMITS.visible).map((value): DownloadEntry => {
      const path = join(this.directory, value.name);
      const old = previous.get(path);
      const unchanged = old && old.value.dev === value.dev && old.value.ino === value.ino && old.value.mtime === value.mtime && old.value.size === value.size && old.value.expiresAt >= this.now();
      const ref = unchanged ? old.ref : randomBytes(18).toString("base64url");
      refs.set(ref, { path, dev: value.dev, ino: value.ino, mtime: value.mtime, size: value.size, kind: value.kind, expiresAt: this.now() + DOWNLOADS_LIMITS.refTtlMs });
      return { ref, name: value.name, kind: value.kind, modifiedAt: Math.round(value.mtime), size: value.kind === "file" ? value.size : null };
    });
    this.publish(generation, { state: entries.length ? (partial ? "partial" : "ok") : partial ? "partial" : "empty", entries }, refs);
  }
  private publish(generation: number, detail: DownloadsDetail, refs: Map<string, Ref>) {
    if (generation !== this.generation) return;
    this.detail = detail; this.refs = refs; this.changed();
    for (const key of this.visuals.keys()) if (!refs.has(key.split("/")[0]!)) this.visuals.delete(key);
  }
  private async verified(ref: string) {
    const target = this.refs.get(ref);
    if (!target || target.expiresAt < this.now()) return null;
    try {
      const info = await lstat(target.path);
      if (!this.refs.has(ref) || info.dev !== target.dev || info.ino !== target.ino || info.mtimeMs !== target.mtime || (info.isFile() ? info.size : 0) !== target.size) return null;
      return { target, regularFile: info.isFile() };
    } catch { return null; }
  }
  async visual(input: DownloadVisualRequest, load: VisualLoader): Promise<DownloadVisual | null> {
    if (!this.visible || !this.refs.has(input.ref)) return null;
    const generation = this.generation;
    const key = `${input.ref}/${input.size}`;
    let flight = this.visuals.get(key);
    if (!flight) {
      flight = this.createVisual(input, generation, load);
      this.visuals.set(key, flight);
    }
    const visual = await flight;
    return this.visible && generation === this.generation && await this.verified(input.ref) ? visual : null;
  }
  private async createVisual(input: DownloadVisualRequest, generation: number, load: VisualLoader) {
    if (this.visualActive >= 4) await new Promise<void>((resolve) => this.visualWaiters.push(resolve));
    else this.visualActive++;
    try {
      if (!this.visible || generation !== this.generation) return null;
      const file = await this.verified(input.ref);
      if (!file) return null;
      return await load(file.target.path, input.size, file.regularFile);
    } catch { return null; }
    finally { const next = this.visualWaiters.shift(); if (next) next(); else this.visualActive--; }
  }
  /** Opens exactly the listed item: an expired, unknown, moved or replaced reference fails closed (INV-14). */
  async open(ref: string): Promise<"opened" | "stale" | "failed"> {
    const file = await this.verified(ref);
    if (!file) { void this.refresh(); return "stale"; }
    const failure = await this.shell.openPath(file.target.path);
    return failure ? "failed" : "opened";
  }
  async revealItem(ref: string): Promise<"opened" | "stale" | "failed"> {
    const file = await this.verified(ref);
    if (!file) { void this.refresh(); return "stale"; }
    if (!this.shell.showItemInFolder) return "failed";
    try { await this.shell.showItemInFolder(file.target.path); return "opened"; }
    catch { return "failed"; }
  }
  async reveal() { return (await this.shell.openPath(this.directory)) ? "failed" : "opened"; }
  close() { this.setVisible(false); }
}
