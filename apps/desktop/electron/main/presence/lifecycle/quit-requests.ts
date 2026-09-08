/**
 * [INPUT]: Depends on Immediate task snapshots, user confirmation, restore intent, and SafeQuitCoordinator.
 * [OUTPUT]: Provides one shared user/update quit flight with passive automatic restart and first-intent ownership.
 * [POS]: Presence user-intent boundary; confirmation always precedes the startup hold.
 */

import { permitsOperation, type StopOperation } from "./start-fence";
import type { SafeQuitCoordinator, SafeQuitReason, SafeQuitResult } from "../../startup/safe-quit";

type Ports = {
  safeQuit: Pick<SafeQuitCoordinator, "prepare">;
  snapshot(): readonly StopOperation[];
  confirm(count: number, reason: SafeQuitReason): Promise<boolean>;
  restoreWindow(): void;
  changed?(): void;
};

/** The first request owns both confirmation and terminal handoff. */
export class QuitRequests {
  private flight: { reason: SafeQuitReason; task: Promise<SafeQuitResult> } | null = null;
  private terminalReason: SafeQuitReason | null = null;
  constructor(private readonly ports: Ports) {}
  get requested() { return this.flight !== null; }
  request(reason: SafeQuitReason, interactive = true): Promise<SafeQuitResult> {
    if (this.terminalReason) return Promise.resolve(this.terminalReason === reason ? "ready" : "aborted");
    if (this.flight) return this.flight.reason === reason ? this.flight.task : Promise.resolve("aborted");
    const task = Promise.resolve().then(() => this.run(reason, interactive)).then((result) => {
      if (result === "ready") this.terminalReason = reason;
      return result;
    }).finally(() => { this.flight = null; });
    this.flight = { reason, task };
    return task;
  }
  private async run(reason: SafeQuitReason, interactive: boolean): Promise<SafeQuitResult> {
    const permit: StopOperation[] = [];
    for (;;) {
      const current = this.ports.snapshot();
      if (reason !== "system" && current.some((operation) => !permitsOperation(permit, operation))) {
        if (!interactive) return "aborted";
        const count = new Set(current.map((operation) => operation.conversationId)).size;
        if (!await this.ports.confirm(count, reason)) {
          this.ports.restoreWindow();
          return "aborted";
        }
        permit.push(...current);
      }
      const pending = this.ports.safeQuit.prepare(reason, permit);
      this.ports.changed?.();
      const result = await pending;
      this.ports.changed?.();
      if (result === "aborted") { if (!interactive) return result; continue; }
      if (result === "failed") this.ports.restoreWindow();
      return result;
    }
  }
}
