/**
 * [INPUT]: Depends on the native bridge port (running apps, resolution, icons, launch, AX status/unminimize) and node:crypto for opaque icon keys.
 * [OUTPUT]: Provides NativeApps: the regular-app running projection with first-seen ordering, bundle/path resolution with a bounded cache, cached installed-app candidates, opaque icon keys and cached PNG data URLs, single-flight launch/activate per target, the optional AX unminimize branch, and capturable generation-fenced cleanup that retires old async work while allowing explicit setup reads and fresh facts after re-enable.
 * [POS]: system-dock/native App adapter (3.3/3.5, INV-08); running means actually running, never "requested"; paths stay in main and renderers only see icon keys.
 */

import { createHash } from "node:crypto";
import type { NativePort } from "./bridge";
import type { ResolvedApp, RunningApp } from "./protocol";
import { BRIDGE_LIMITS } from "./protocol";

export type LaunchOutcome = { status: "activated" | "launched" | "missing" | "failed"; restored: number | null; axTrusted: boolean };
const iconKeyFor = (path: string) => `i${createHash("sha256").update(path).digest("base64url").slice(0, 24)}`;

export class NativeApps {
  private running: RunningApp[] = [];
  private readonly firstSeen = new Map<number, number>();
  private seen = 0;
  private generation = 0;
  private readonly resolved = new Map<string, { value: ResolvedApp | null; at: number }>();
  private readonly iconPaths = new Map<string, string>();
  private readonly icons = new Map<string, string>();
  private readonly launches = new Map<string, Promise<LaunchOutcome>>();
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  private installed: { at: number; apps: { path: string; bundleIdentifier: string | null; name: string }[]; flight: Promise<void> | null } = { at: 0, apps: [], flight: null };
  constructor(private readonly native: NativePort, private ownBundleId: string | null, private readonly now = Date.now, private readonly ownPid = process.pid) {}
  async start() {
    if (this.stop) return;
    const generation = this.generation;
    this.stop = this.native.onEvent((event) => { if (generation === this.generation && event.event === "running") this.accept(event.apps); });
    try {
      const apps = await this.native.request({ op: "running-apps" });
      if (generation === this.generation) this.accept(apps);
    } catch (cause) { console.warn("[system-dock] running apps unavailable", cause); }
  }
  /** Capture one async operation lifetime, including explicit reads made while the Dock is off. */
  captureGeneration(): () => boolean { const generation = this.generation; return () => generation === this.generation; }
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private accept(apps: RunningApp[]) {
    const live = new Set(apps.map((app) => app.pid));
    for (const pid of [...this.firstSeen.keys()]) if (!live.has(pid)) this.firstSeen.delete(pid);
    for (const app of apps) if (!this.firstSeen.has(app.pid)) this.firstSeen.set(app.pid, ++this.seen);
    this.running = apps;
    // The host is identified by its own process, so dev builds and every packaged flavor exclude themselves.
    this.ownBundleId ??= apps.find((app) => app.pid === this.ownPid)?.bundleIdentifier ?? null;
    for (const listener of [...this.listeners]) listener();
  }
  /**
   * Candidates for the temporary running area: regular activation policy only (accessory apps may
   * still be pinned by hand), de-duplicated by bundle identity, never the host itself, first-seen order.
   */
  runningRegular(): RunningApp[] {
    const byIdentity = new Map<string, RunningApp>();
    for (const app of [...this.running].sort((a, b) => (this.firstSeen.get(a.pid) ?? 0) - (this.firstSeen.get(b.pid) ?? 0))) {
      if (app.activationPolicy !== "regular" || (this.ownBundleId && app.bundleIdentifier === this.ownBundleId)) continue;
      const identity = app.bundleIdentifier ?? app.path ?? `pid:${app.pid}`;
      if (!byIdentity.has(identity)) byIdentity.set(identity, app);
    }
    return [...byIdentity.values()];
  }
  isRunning(target: { bundleIdentifier: string | null; path: string | null }) {
    return this.running.some((app) => (target.bundleIdentifier && app.bundleIdentifier === target.bundleIdentifier) || (target.path && app.path === target.path));
  }
  frontmostPid() {
    return this.running.find((app) => app.active && app.pid !== this.ownPid && app.bundleIdentifier !== this.ownBundleId)?.pid ?? null;
  }
  /** LaunchServices first; a cached miss expires so moved/reinstalled apps re-resolve (3.3). `undefined` means the helper
      could not answer; it is never cached, so a slow LaunchServices at login does not turn every app into "missing" (F-21). */
  async resolve(input: { bundleIdentifier?: string | null; path?: string | null }): Promise<ResolvedApp | null | undefined> {
    const key = input.bundleIdentifier ? `b:${input.bundleIdentifier}` : input.path ? `p:${input.path}` : null;
    if (!key) return null;
    const cached = this.resolved.get(key);
    if (cached && this.now() - cached.at < (cached.value ? 5 * 60_000 : 30_000)) return cached.value;
    const generation = this.generation;
    let value: ResolvedApp | null = null;
    try { value = await this.native.request(input.bundleIdentifier ? { op: "resolve-app", bundleIdentifier: input.bundleIdentifier } : { op: "resolve-app", path: input.path! }); }
    catch (cause) { console.warn("[system-dock] resolve failed", cause); return undefined; }
    if (generation !== this.generation) return undefined;
    this.resolved.set(key, { value, at: this.now() });
    if (this.resolved.size > 512) this.resolved.delete(this.resolved.keys().next().value!);
    return value;
  }
  invalidate() { this.resolved.clear(); }
  /** Add-picker candidates only; cached for a minute and refreshed in the background (3.3). */
  installedApps() {
    if (!this.installed.flight && this.now() - this.installed.at > 60_000) {
      const generation = this.generation;
      this.installed.flight = this.native.request({ op: "installed-apps" }, 10_000)
        .then((apps) => {
          if (generation !== this.generation) return;
          this.installed.apps = apps; this.installed.at = this.now(); for (const listener of [...this.listeners]) listener();
        })
        .catch((cause) => console.warn("[system-dock] installed apps unavailable", cause))
        .finally(() => { if (generation === this.generation) this.installed.flight = null; });
    }
    return this.installed.apps;
  }
  iconKey(path: string | null): string | null {
    if (!path) return null;
    const key = iconKeyFor(path);
    this.iconPaths.set(key, path);
    return key;
  }
  /** Renderers ask by opaque key only; unknown keys are silently ignored. */
  async iconData(keys: readonly string[]): Promise<Record<string, string>> {
    const generation = this.generation;
    const result: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of keys.slice(0, 128)) {
      const cached = this.icons.get(key);
      if (cached) result[key] = cached;
      else if (this.iconPaths.has(key)) missing.push(key);
    }
    for (let index = 0; index < missing.length && generation === this.generation; index += BRIDGE_LIMITS.iconBatch) {
      const batch = missing.slice(index, index + BRIDGE_LIMITS.iconBatch);
      try {
        const data = await this.native.request({ op: "icons", paths: batch.map((key) => this.iconPaths.get(key)!), size: BRIDGE_LIMITS.iconSize }, 10_000);
        if (generation !== this.generation) break;
        for (const key of batch) {
          const value = data[this.iconPaths.get(key)!];
          if (!value?.startsWith("data:image/png;base64,")) continue;
          this.icons.set(key, value); result[key] = value;
        }
      } catch (cause) { console.warn("[system-dock] icons failed", cause); }
    }
    while (this.icons.size > 256) this.icons.delete(this.icons.keys().next().value!);
    return result;
  }
  /**
   * Launch or activate through the public LaunchServices path; concurrent clicks on one target
   * share a single request, and a sent request is never reported as a restored window (INV-08).
   */
  launch(target: { path: string; bundleIdentifier: string | null }, restoreMinimized: boolean): Promise<LaunchOutcome> {
    const key = target.path;
    const existing = this.launches.get(key);
    if (existing) return existing;
    const wasRunning = this.isRunning(target);
    const generation = this.generation;
    const run: Promise<LaunchOutcome> = (async (): Promise<LaunchOutcome> => {
      try {
        const result = await this.native.request({ op: "launch", path: target.path, activate: true }, 15_000);
        if (generation !== this.generation || !restoreMinimized || !wasRunning || !result.pid) return { status: wasRunning ? "activated" : "launched", restored: null, axTrusted: false };
        const restored = await this.native.request({ op: "unminimize", pid: result.pid }, 3_000).catch(() => null);
        const trusted = generation === this.generation && Boolean(restored?.trusted);
        return { status: "activated", restored: trusted ? restored!.restored : null, axTrusted: trusted };
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? "";
        return { status: code.includes("NOT_FOUND") ? "missing" : "failed", restored: null, axTrusted: false };
      }
    })().finally(() => { if (this.launches.get(key) === run) this.launches.delete(key); });
    this.launches.set(key, run);
    return run;
  }
  async accessibility(prompt: boolean): Promise<boolean> {
    try { return (await this.native.request({ op: "ax-status", prompt })).trusted; } catch { return false; }
  }
  close() {
    // Retire accepted work without blocking later explicit setup reads or a new observation lifetime.
    this.generation++;
    this.stop?.(); this.stop = null; this.listeners.clear(); this.running = []; this.firstSeen.clear(); this.seen = 0; this.invalidate();
    this.installed = { at: 0, apps: [], flight: null }; this.launches.clear();
  }
}
