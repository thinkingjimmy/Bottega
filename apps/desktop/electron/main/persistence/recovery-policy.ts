/**
 * [INPUT]: Receives the main composition root's profile-scoped corruption recovery owner.
 * [OUTPUT]: Connects strict DurableJson parsing to explicit category recovery and held-writer release, defers named startup recovery tasks (skippable or required) behind the gate, and lets a user-facing launch wait for the gate (awaitRecoveredAuthority, bounded) or refuse with a named RecoveryPendingError; every refusal (assertRecoveredAuthority included) is that one coded error, whose message is the action line, and it names the current reason (recoveryPendingReason).
 * [POS]: Dependency inversion for persistence; standalone stores keep strict behavior unless recovery is installed.
 */
export type DurableRecovery = { held: boolean; released(write: () => Promise<void>): void };
export type DurableRecoveryOwner = (filePath: string, content: string | null) => Promise<DurableRecovery | null>;
let recover: DurableRecoveryOwner | null = null;
export function installDurableRecovery(owner: DurableRecoveryOwner) {
  if (recover) throw new Error("DURABLE_RECOVERY_ALREADY_INSTALLED");
  recover = owner; return () => { if (recover === owner) recover = null; };
}
export function recoverDurableCorruption(path: string, content: string | null) { return recover?.(path, content) ?? Promise.resolve(null); }
/** `required` tasks enforce a restriction of their own; the rest may be skipped when they fail. */
export type DeferredRecovery = Readonly<{ name: string; required?: boolean }>;
/* `pending`: a held file still waits for an earlier process to exit (as opposed to startup not having sealed yet, or deferred startup
   tasks still running); it names the reason a bounded wait gives up with. */
let gate: { blocked(): boolean; pending(): boolean; defer(task: () => Promise<void>, recovery: DeferredRecovery): void } | null = null;
export function installRecoveryGate(value: NonNullable<typeof gate>) {
  if (gate) throw new Error("RECOVERY_GATE_ALREADY_INSTALLED");
  gate = value; return () => { if (gate === value) gate = null; };
}
export const recoveryBlocked = () => gate?.blocked() ?? false;
/** Refuses at once, coded, while the gate is closed; a person-facing entry waits first (awaitRecoveredAuthority). */
export function assertRecoveredAuthority() { if (recoveryBlocked()) throw new RecoveryPendingError(recoveryPendingReason() ?? "startup-recovery-pending"); }

export type RecoveryPendingReason = "startup-recovery-pending" | "earlier-process-holding";
/** Startup recovery refused an action (at once, or past a wait's bound), coded by its reason; the message is the action line. */
export class RecoveryPendingError extends Error {
  readonly code: RecoveryPendingReason;
  constructor(readonly reason: RecoveryPendingReason) {
    super(reason === "earlier-process-holding" ? "An earlier Agent process is still finishing. Try again in a moment."
      : "Bottega is still finishing its startup checks. Try again in a moment.");
    this.name = "RecoveryPendingError";
    this.code = reason;
  }
}
export const RECOVERY_WAIT_MS = 15_000;
/** Why startup recovery holds starts right now, or null while it is open. */
export const recoveryPendingReason = (): RecoveryPendingReason | null =>
  !recoveryBlocked() ? null : gate?.pending() ? "earlier-process-holding" : "startup-recovery-pending";
/**
 * What a user-facing launch (a Provider's readiness, a turn's process, an App server) calls before custody: returns at once while the
 * gate is open; otherwise waits for it to open (startup sealing, deferred startup tasks, an earlier process exiting) up to `timeoutMs`,
 * then refuses with a named reason.
 */
export async function awaitRecoveredAuthority(options: { timeoutMs?: number; pollMs?: number } = {}) {
  if (!recoveryBlocked()) return;
  const deadline = Date.now() + (options.timeoutMs ?? RECOVERY_WAIT_MS);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 100));
    if (!recoveryBlocked()) return;
  }
  throw new RecoveryPendingError(recoveryPendingReason() ?? "startup-recovery-pending");
}
export async function recoverOrDefer(task: () => Promise<void>, recovery: DeferredRecovery = { name: "startup-recovery" }) {
  if (gate?.blocked()) gate.defer(task, recovery); else await task();
}
