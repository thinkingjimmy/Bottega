/**
 * [INPUT]: Current source bindings/lifecycle facts, real filesystem events and the composition's coalesced scheduler.
 * [OUTPUT]: PluginSourceObserver checks startup/re-enable/rebind source and owns exact watches including missing-folder recovery.
 * [POS]: Operation-loaded watcher owner; it schedules source checks without selecting a runtime or enabling plugins.
 */
import { existsSync, lstatSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
type Source = { id: string; sourceDirectory?: string; enabled: boolean; status: string; hasActive: boolean; busy?: boolean };
type Binding = { source: string; root: string; watcher: FSWatcher };
type Ports = { schedule(id: string): void; changedDuringBuild(id: string): void; failed(id: string, cause: unknown): void };
const inside = (root: string, path: string) => { const tail = relative(root, path); return tail !== ".." && !tail.startsWith("../") && !isAbsolute(tail); };
export class PluginSourceObserver {
  private readonly records = new Map<string, Source>();
  private readonly watches = new Map<string, Binding>();
  private readonly failed = new Set<string>();
  private readonly checks = new Set<string>();
  private closed = false;
  constructor(private readonly ports: Ports) {}
  reconcile(records: readonly Source[]) {
    if (this.closed) return;
    const ids = new Set(records.map(record => record.id));
    for (const id of this.records.keys()) if (!ids.has(id)) this.reset(id);
    for (const record of records) {
      const previous = this.records.get(record.id), rebound = previous?.sourceDirectory !== record.sourceDirectory;
      if (!previous || rebound || !previous.enabled && record.enabled) {
        if (rebound || !previous?.enabled && record.enabled) this.failed.delete(record.id);
        if (record.sourceDirectory || !record.hasActive) this.checks.add(record.id);
      }
      this.records.set(record.id, { ...record });
      if (record.sourceDirectory && (!this.watches.has(record.id) || rebound) && !this.failed.has(record.id)) this.attach(record);
      if (record.enabled && this.checks.has(record.id) && !record.busy && !["preparing", "draining"].includes(record.status)) {
        this.checks.delete(record.id); this.ports.schedule(record.id);
      }
    }
  }
  reset(id: string) { this.watches.get(id)?.watcher.close(); this.watches.delete(id); this.failed.delete(id); this.checks.delete(id); this.records.delete(id); }
  private root(source: string) {
    for (let candidate = source; ; candidate = dirname(candidate)) {
      try { const info = lstatSync(candidate); if (info.isSymbolicLink()) throw new Error("Plugin source watch directory is a symbolic link"); if (info.isDirectory()) return candidate; throw new Error("Plugin source watch target is not a directory"); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
      if (dirname(candidate) === candidate) throw new Error("Plugin source watch directory is unavailable");
    }
  }
  private attach(record: Source) {
    if (this.closed || !record.sourceDirectory) return;
    try {
      const source = record.sourceDirectory, root = this.root(source), existing = this.watches.get(record.id);
      if (existing?.source === source && existing.root === root) return;
      existing?.watcher.close(); this.watches.delete(record.id);
      const watcher = watch(root, { recursive: root === source }, (kind, name) => {
        if (this.closed || this.records.get(record.id)?.sourceDirectory !== source) return;
        // macOS can replay the watched directory's own metadata event when the stream attaches.
        if (kind === "change" && name?.toString() === basename(root) && !existsSync(resolve(root, name.toString()))) return;
        const changed = name ? resolve(root, name.toString()) : root;
        if (!inside(source, changed) && !inside(changed, source)) return;
        if (relative(source, changed).split("/").some(part => ["node_modules", ".git"].includes(part))) return;
        const current = this.records.get(record.id); if (!current) return;
        this.attach(current);
        if (current.enabled) { this.ports.changedDuringBuild(record.id); this.ports.schedule(record.id); }
        else this.checks.add(record.id);
      });
      const binding = { source, root, watcher }; this.watches.set(record.id, binding);
      watcher.on("error", cause => {
        if (this.closed || this.watches.get(record.id) !== binding) return;
        watcher.close(); this.watches.delete(record.id); this.failed.add(record.id); this.ports.failed(record.id, cause);
      });
    } catch (cause) { this.failed.add(record.id); this.ports.failed(record.id, cause); }
  }
  close() { this.closed = true; for (const binding of this.watches.values()) binding.watcher.close(); this.watches.clear(); this.records.clear(); this.checks.clear(); }
}
