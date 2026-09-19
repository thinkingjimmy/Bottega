/**
 * [INPUT]: Receives the main composition root's profile-scoped corruption recovery owner.
 * [OUTPUT]: Connects strict DurableJson parsing to explicit category recovery and held-writer release.
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
export class DurableRecoveryHeldError extends Error {
  constructor() { super("An earlier Agent process may still be using these files. Bottega will restore execution and cleanup after confirming that it has exited."); this.name = "DurableRecoveryHeldError"; }
}
let gate: { blocked(): boolean; defer(task: () => Promise<void>): void } | null = null;
export function installRecoveryGate(value: NonNullable<typeof gate>) {
  if (gate) throw new Error("RECOVERY_GATE_ALREADY_INSTALLED");
  gate = value; return () => { if (gate === value) gate = null; };
}
export const recoveryBlocked = () => gate?.blocked() ?? false;
export function assertRecoveredAuthority() { if (recoveryBlocked()) throw new DurableRecoveryHeldError(); }
export async function recoverOrDefer(task: () => Promise<void>) {
  if (gate?.blocked()) gate.defer(task); else await task();
}
