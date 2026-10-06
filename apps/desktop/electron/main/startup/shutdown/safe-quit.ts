/**
 * [INPUT]: Depends on Owned startup holds, synchronous operation permissions, and existing shutdown/recovery ports.
 * [OUTPUT]: Provides safeQuitCoordinator with ready/aborted/failed results, `quitting` (in flight or completed), a bounded wait for an in-flight startup before agents quiesce and owners close, and an authorization boundary before global shutdown, a user-confirmed forced quit when Agents cannot be confirmed stopped; settleStartup.
 * Carries exact failure stage, confirmed draft persistence and unconfirmed window names; Agent force quit is offered only after quiescence fails. System shutdown is noninteractive; failed recovery after cancellation uses a notice instead of a second dialog.
 * [POS]: Single process-wide safe-quit owner shared by user quit, update installation, and system shutdown.
 */

import { permitsOperation, type StopOperation } from "../../presence/lifecycle/start-fence";
import { DraftSettlementError } from "../../window/surfaces/core/draft-settlement";

export type SafeQuitReason = "quit" | "update" | "system";
export type SafeQuitResult = "ready" | "aborted" | "failed";
export type QuitFailure = Readonly<{ stage: string; cause: unknown; draftsSaved: boolean; unconfirmedWindows: readonly string[] }>;
export type SafeQuitPorts = {
  acquireStartHold?(): () => void;
  snapshotStopOperations?(): readonly StopOperation[];
  stopAdmission(): void;
  settleWindows(): Promise<void>;
  /** Waits (bounded) for a startup initialize still in flight: nothing may close under it. */
  awaitStartup?(): Promise<void>;
  quiesceAgents(): Promise<void>;
  closeOwners(): Promise<void>;
  recover(reason: SafeQuitReason): Promise<boolean>;
  report(reason: SafeQuitReason, phase: "reversible" | "terminal", cause: unknown): void;
  /** A user quit whose Agents could not be confirmed stopped may still leave: the person decides, and true skips recovery. */
  confirmForce?(failure: QuitFailure): Promise<boolean>;
  notify(recovered: boolean, failure: QuitFailure, presentation: "dialog" | "notice"): void | Promise<void>;
  quit(): void;
};

/**
 * Resolves once the startup flight settles, either way, or after `boundMs`: quit must not close the owners under a running
 * initialize, and must not hang on one that never ends.
 */
export async function settleStartup(flight: Promise<unknown> | null, boundMs: number): Promise<void> {
  if (!flight) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([flight.then(() => undefined, () => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, boundMs); })]);
  clearTimeout(timer);
}

export class SafeQuitCoordinator {
  private flight: Promise<SafeQuitResult> | null = null;
  private terminal: SafeQuitResult | null = null;
  constructor(private readonly ports: SafeQuitPorts) {}
  get finished() { return this.terminal !== null; }
  get requested() { return this.flight !== null; }
  /** A quit in flight or already completed: a startup failure seen after prepare settled is still a quit, not data damage. */
  get quitting() { return this.requested || this.finished; }

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
    let stage = "admission";
    let draftsSaved = false;
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
      stage = "settle-windows";
      await this.ports.settleWindows();
      draftsSaved = true;
      /* Only a registered startup is waited for: without one, quit keeps its exact sequence (no added tick). */
      stage = "await-startup";
      if (this.ports.awaitStartup) await this.ports.awaitStartup();
      stage = "quiesce-agents";
      await this.ports.quiesceAgents();
    } catch (cause) {
      this.ports.report(reason, "reversible", new Error(`${stage}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }));
      const failure: QuitFailure = { stage, cause, draftsSaved,
        unconfirmedWindows: cause instanceof DraftSettlementError ? cause.windows.map(window => window.title) : [] };
      // Only saved drafts may cross the explicit force-quit boundary after task shutdown fails.
      const forceOffered = frozen && stage === "quiesce-agents" && reason === "quit" && Boolean(this.ports.confirmForce);
      if (forceOffered && await this.ports.confirmForce!(failure).catch(() => false)) return this.close(reason);
      let recovered = !frozen && !releaseAttempted;
      try {
        if (frozen) recovered = await this.ports.recover(reason);
        if (recovered) releaseOwnedHold();
      } catch (recoveryCause) {
        recovered = false;
        this.ports.report(reason, "reversible", recoveryCause);
      }
      if (!recovered && frozen) this.ports.stopAdmission();
      if (reason !== "system" && (!forceOffered || !recovered)) {
        try { await this.ports.notify(recovered, failure, forceOffered ? "notice" : "dialog"); }
        catch (notificationCause) { this.ports.report(reason, "reversible", notificationCause); }
      }
      return "failed";
    }
    return this.close(reason);
  }

  private async close(reason: SafeQuitReason): Promise<SafeQuitResult> {
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
