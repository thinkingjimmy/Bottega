/**
 * [INPUT]: Depends on the native bridge port (getattrlist trash state, FSEvents watch, Finder Automation preflight and the single empty-trash Apple Event).
 * [OUTPUT]: Provides TrashEntry: demand-scoped empty/full/unknown state with native watching only while a consumer is visible, non-prompting automation preflight, a user-triggered permission request, and exactly-once emptying claimed before the preflight with honest unknown outcomes and a forced re-read.
 * [POS]: system-dock/entries Trash adapter (3.5, INV-12/14); never recycles, never builds rm commands, never retries, never reports a guessed empty.
 */

import type { TrashDetail, TrashState } from "../../../../shared/system-dock/ipc";
import type { NativePort } from "../native/bridge";

export const EMPTY_TRASH_TIMEOUT_MS = 30_000;

export class TrashEntry {
  private state: TrashState = "unknown";
  private automation: TrashDetail["automation"] = "unknown";
  private lastResult: TrashDetail["lastResult"] = "none";
  private emptying = false;
  private consumers = new Set<string>();
  private watching = false;
  private stop: (() => void) | null = null;
  constructor(private readonly native: NativePort, private readonly changed: () => void) {}
  snapshot(): TrashDetail { return { state: this.state, emptying: this.emptying, automation: this.automation, lastResult: this.lastResult }; }
  face(): TrashState { return this.state; }
  /** Each surface (bar reveal, Trash detail) is a separate consumer; the last release stops native work (INV-11). */
  demand(consumer: string, active: boolean) {
    if (active) this.consumers.add(consumer); else this.consumers.delete(consumer);
    const want = this.consumers.size > 0;
    if (want === this.watching) return;
    this.watching = want;
    if (want) {
      this.stop ??= this.native.onEvent((event) => { if (event.event === "trash" && this.watching) this.accept(event.state.state); });
      void this.native.request({ op: "watch-trash", enabled: true }).catch(() => undefined);
      void this.read();
    } else void this.native.request({ op: "watch-trash", enabled: false }).catch(() => undefined);
  }
  private accept(state: TrashState) { if (state !== this.state) { this.state = state; this.changed(); } }
  async read() {
    try { this.accept((await this.native.request({ op: "trash-state" }, 8_000)).state); } catch { this.accept("unknown"); }
  }
  /** Preflight never prompts; the prompt only follows an explicit user action (3.5). */
  async preflight(prompt = false) {
    try {
      const result = await this.native.request({ op: "automation-status", prompt }, prompt ? 120_000 : 5_000);
      this.automation = result.status;
    } catch { this.automation = "unavailable"; }
    this.changed();
    return this.automation;
  }
  /** One confirmed Finder action; a timeout is an unknown outcome, never a retry (INV-14). */
  async empty(): Promise<TrashDetail["lastResult"]> {
    // Claimed before the first await: a second request arriving during the preflight must not send a second command.
    if (this.emptying) return this.lastResult;
    this.emptying = true; this.changed();
    if ((await this.preflight(false)) !== "granted") {
      this.emptying = false;
      this.lastResult = this.automation === "denied" ? "denied" : "none"; this.changed(); return this.lastResult;
    }
    try {
      const result = await this.native.request({ op: "empty-trash", timeoutMs: EMPTY_TRASH_TIMEOUT_MS }, EMPTY_TRASH_TIMEOUT_MS + 5_000);
      this.lastResult = result.result === "emptied" ? "emptied" : result.result === "timeout" ? "unknown" : result.result === "denied" ? "denied" : result.result === "cancelled" ? "cancelled" : "failed";
    } catch { this.lastResult = "unknown"; }
    finally { this.emptying = false; }
    await this.read();
    if (this.lastResult === "emptied" && this.state === "full") this.lastResult = "partial";
    this.changed();
    return this.lastResult;
  }
  close() { this.consumers.clear(); if (this.watching) void this.native.request({ op: "watch-trash", enabled: false }).catch(() => undefined); this.watching = false; this.stop?.(); this.stop = null; }
}
