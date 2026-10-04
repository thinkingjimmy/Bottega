/**
 * [INPUT]: Depends on Node fs/path/perf_hooks primitives, the shared startup-trace contract, and an ipcMain-like renderer channel.
 * [OUTPUT]: Provides the process-wide startupTrace recorder: always-on in-memory marks and start/end spans, opt-in stderr milestones, renderer mark intake gated by the caller's trusted-sender proof and a debug JSON dump.
 * [POS]: The only startup timing owner in the main process; index.ts, main-window.ts and post-window-tasks.ts mark through it and never keep their own clocks.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  STARTUP_TRACE_ARGUMENT,
  STARTUP_TRACE_CHANNEL,
  compileCacheStatus,
  type StartupMark,
} from "../../../../shared/startup/startup-trace";

/** The renderer keeps marking while the shell hydrates; one late dump catches those. */
const LATE_DUMP_MS = 10_000;
const MAX_RENDERER_MARK = 64;

type TraceEvent = { sender: { id: number } };
type TraceIpc = {
  on(channel: string, listener: (event: TraceEvent, ...args: unknown[]) => void): unknown;
};

export class StartupTrace {
  readonly enabled: boolean;
  private readonly entries: StartupMark[] = [];
  private output: string | null = null;

  constructor(enabled = Boolean(process.env.BOTTEGA_STARTUP_TRACE)) {
    this.enabled = enabled;
    const cache = compileCacheStatus();
    if (cache) this.mark(`compile-cache:${cache.status}`, cache.detail, cache.at);
  }

  mark(name: string, detail?: string, at = performance.now()) {
    this.entries.push(detail ? { name, at, detail } : { name, at });
    if (!this.enabled) return;
    const elapsed = at.toFixed(0).padStart(5);
    process.stderr.write(`[startup] +${elapsed}ms ${name}${detail ? ` ${detail}` : ""}\n`);
  }

  /** Marks `<name>:start` and `<name>:end` around one startup step, so the collector can time it (E-14). */
  async span<T>(name: string, run: () => Promise<T>): Promise<T> {
    this.mark(`${name}:start`);
    try { return await run(); } finally { this.mark(`${name}:end`); }
  }

  marks(): readonly StartupMark[] {
    return this.entries;
  }

  /** Renderer arguments are the only channel a sandboxed preload can read before IPC exists. */
  rendererArguments(): readonly string[] {
    return this.enabled ? [STARTUP_TRACE_ARGUMENT] : [];
  }

  /** `trusted` proves the sender is the main window's own top frame on its renderer entry, like every renderer IPC. */
  registerRenderer(ipc: TraceIpc, trusted: (event: TraceEvent) => boolean) {
    if (!this.enabled) return;
    ipc.on(STARTUP_TRACE_CHANNEL, (event, name) => {
      if (!trusted(event)) return;
      if (typeof name !== "string" || !name || name.length > MAX_RENDERER_MARK) return;
      this.mark(`renderer:${name}`);
    });
  }

  /** Dumps once for the window-ready picture and once more after the shell settles. */
  persist(userData: string) {
    if (!this.enabled) return;
    this.output = join(userData, "debug", "startup-trace.json");
    void this.dump();
    setTimeout(() => void this.dump(), LATE_DUMP_MS).unref();
  }

  private async dump() {
    const output = this.output;
    if (!output) return;
    try {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(this.entries, null, 2)}\n`);
    } catch (cause) {
      console.warn("[startup] trace dump unavailable", cause);
    }
  }
}

export const startupTrace = new StartupTrace();
