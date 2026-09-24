/**
 * [INPUT]: Depends on Node fs/path/crypto, Electron shell (injected), and the shared DownloadsDetail DTO.
 * [OUTPUT]: Provides DownloadsEntry: visibility-driven, bounded first-level listing of the Downloads folder (newest 20 by modification time, scan/concurrency/time limits, honest partial results), directory-event refresh while visible, short-lived opaque references re-verified by device/inode before opening, and the always-available reveal in Finder.
 * [POS]: system-dock/entries Downloads adapter (3.5, INV-11/13/14); runs on libuv's thread pool, never the Electron main thread, never reads file contents, and never hands a path to a renderer.
 */

import { randomBytes } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import type { DownloadEntry, DownloadsDetail } from "../../../../shared/system-dock/ipc";

export const DOWNLOADS_LIMITS = { visible: 20, scan: 2_000, concurrency: 16, timeoutMs: 5_000, refTtlMs: 5 * 60_000, debounceMs: 500 } as const;
const PACKAGE_EXTENSIONS = new Set([".app", ".bundle", ".pkg", ".mpkg", ".framework", ".plugin", ".kext", ".xcodeproj", ".playground", ".rtfd", ".pages", ".numbers", ".key"]);
type Ref = { path: string; dev: number; ino: number; kind: DownloadEntry["kind"]; expiresAt: number };
export type ShellPort = { openPath(path: string): Promise<string> };

export class DownloadsEntry {
  private detail: DownloadsDetail = { state: "loading", entries: [] };
  private refs = new Map<string, Ref>();
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private flight: Promise<void> | null = null;
  constructor(private readonly shell: ShellPort, private readonly changed: () => void, readonly directory = join(homedir(), "Downloads"), private readonly now = Date.now) {}
  snapshot(): DownloadsDetail { return this.detail; }
  /** A visible Downloads detail is the only consumer; hiding stops watching and forgets references. */
  setVisible(visible: boolean) {
    if (!visible) { this.generation++; this.watcher?.close(); this.watcher = null; if (this.timer) clearTimeout(this.timer); this.timer = null; this.refs.clear(); return; }
    if (this.watcher) return;
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
    this.flight = this.scan(generation).finally(() => { this.flight = null; });
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
    const entries = stats.slice(0, DOWNLOADS_LIMITS.visible).map((value): DownloadEntry => {
      const ref = randomBytes(18).toString("base64url");
      refs.set(ref, { path: join(this.directory, value.name), dev: value.dev, ino: value.ino, kind: value.kind, expiresAt: this.now() + DOWNLOADS_LIMITS.refTtlMs });
      return { ref, name: value.name, kind: value.kind, modifiedAt: Math.round(value.mtime), size: value.kind === "file" ? value.size : null };
    });
    this.publish(generation, { state: entries.length ? (partial ? "partial" : "ok") : partial ? "partial" : "empty", entries }, refs);
  }
  private publish(generation: number, detail: DownloadsDetail, refs: Map<string, Ref>) {
    if (generation !== this.generation) return;
    this.detail = detail; this.refs = refs; this.changed();
  }
  /** Opens exactly the listed item: an expired, unknown, moved or replaced reference fails closed (INV-14). */
  async open(ref: string): Promise<"opened" | "stale" | "failed"> {
    const target = this.refs.get(ref);
    if (!target || target.expiresAt < this.now()) return "stale";
    try {
      const info = await lstat(target.path);
      if (info.dev !== target.dev || info.ino !== target.ino) { void this.refresh(); return "stale"; }
    } catch { void this.refresh(); return "stale"; }
    const failure = await this.shell.openPath(target.path);
    return failure ? "failed" : "opened";
  }
  async reveal() { return (await this.shell.openPath(this.directory)) ? "failed" : "opened"; }
  close() { this.setVisible(false); }
}
