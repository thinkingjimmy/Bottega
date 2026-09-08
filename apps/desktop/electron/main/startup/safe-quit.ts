/**
 * [INPUT]: Depends on Owned startup holds, synchronous operation permissions, and existing shutdown/recovery ports.
 * [OUTPUT]: Provides safeQuitCoordinator with ready/aborted/failed results and an authorization boundary before global shutdown.
 * [POS]: Single process-wide safe-quit owner shared by user quit, update installation, and system shutdown.
 */

import { permitsOperation, type StopOperation } from "../presence/lifecycle/start-fence";

export type SafeQuitReason = "quit" | "update" | "system";
export type SafeQuitResult = "ready" | "aborted" | "failed";
export type SafeQuitPorts = {
  acquireStartHold?(): () => void;
  snapshotStopOperations?(): readonly StopOperation[];
  stopAdmission(): void;
  settleWindows(): Promise<void>;
  quiesceAgents(): Promise<void>;
  closeOwners(): Promise<void>;
  recover(reason: SafeQuitReason): Promise<boolean>;
  report(reason: SafeQuitReason, phase: "reversible" | "terminal", cause: unknown): void;
  notify(recovered: boolean): void;
  quit(): void;
};

export class SafeQuitCoordinator {
  private flight: Promise<SafeQuitResult> | null = null;
  private terminal: SafeQuitResult | null = null;
  constructor(private readonly ports: SafeQuitPorts) {}
  get finished() { return this.terminal !== null; }
  get requested() { return this.flight !== null; }

  prepare(reason: SafeQuitReason, permit: readonly StopOperation[] = []): Promise<SafeQuitResult> {
    if (this.terminal) return Promise.resolve(this.terminal);
    if (this.flight) return this.flight;
    let finish!: (result: SafeQuitResult) => void;
    const flight = new Promise<SafeQuitResult>((resolve) => { finish = resolve; });
    this.flight = flight;
    void this.run(reason, permit).then((result) => {
      this.flight = null;
      finish(result);
    });
    return flight;
  }

  private async run(reason: SafeQuitReason, permit: readonly StopOperation[]): Promise<SafeQuitResult> {
    let release: (() => void) | undefined;
    let frozen = false;
    let releaseAttempted = false;
    const releaseOwnedHold = () => {
      releaseAttempted = true;
      release?.();
    };
    try {
      release = this.ports.acquireStartHold?.();
      // Nothing asynchronous may separate acquiring the hold from enumerating identities.
      const current = this.ports.snapshotStopOperations?.() ?? [];
      if (reason !== "system" && current.some((operation) => !permitsOperation(permit, operation))) {
        releaseOwnedHold();
        return "aborted";
      }
      frozen = true;
      this.ports.stopAdmission();
      await this.ports.settleWindows();
      await this.ports.quiesceAgents();
    } catch (cause) {
      this.ports.report(reason, "reversible", cause);
      let recovered = !frozen && !releaseAttempted;
      try {
        if (frozen) recovered = await this.ports.recover(reason);
        if (recovered) releaseOwnedHold();
      } catch (recoveryCause) {
        recovered = false;
        this.ports.report(reason, "reversible", recoveryCause);
      }
      if (!recovered && frozen) this.ports.stopAdmission();
      this.ports.notify(recovered);
      return "failed";
    }
    try {
      await this.ports.closeOwners();
      this.terminal = "ready";
      return "ready";
    } catch (cause) {
      this.ports.report(reason, "terminal", cause);
      this.terminal = "failed";
      this.ports.quit();
      return "failed";
    }
  }
}
