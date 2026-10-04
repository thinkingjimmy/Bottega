/**
 * [INPUT]: Depends on the built-in Provider descriptors.
 * [OUTPUT]: Provides ProviderAdmissionRefusal, ProviderAdmissionRefused, ProviderAdmissionGate, installProviderAdmissionGate and assertProviderAdmitted, installProviderRevocationCheck and assertProviderNotRevoked (the synchronous last check before a bridge is created, d4c): the one question every Provider bridge start asks, answered by the installed gate.
 * [POS]: The package-Provider admission hook (TASK-11 d4-0). The default admits the four built-ins and refuses any other id (`unknown-provider`); the security lane's gate (d4c: package active, trust verdict, Plugins & Apps switch, third-party modules refused until they can be isolated) replaces it. Built-ins' per-process admission (safety lock, `plugin-disabled`) stays in agent-process-supervisor.
 */
import { BUILTIN_PROVIDER_DESCRIPTORS } from "../../../../shared/providers/builtin";

export type ProviderAdmissionRefusal =
  | "unknown-provider"
  | "package-inactive"
  | "trust-refused"
  | "plugin-disabled"
  /* A third-party Provider's bridge module has no isolation boundary yet (the OS-fenced host is 0.2.0), so production refuses it (G5). */
  | "provider-module-third-party-refused"
  /* The gate itself threw: admission fails closed, with the gate's message in the diagnostic. */
  | "gate-failed";

export class ProviderAdmissionRefused extends Error {
  constructor(readonly providerId: string, readonly reason: ProviderAdmissionRefusal, detail?: string) {
    super(`The ${providerId} Provider is not admitted (${reason})${detail ? `: ${detail.slice(0, 300)}` : "."}`);
    this.name = "ProviderAdmissionRefused";
  }
}

/** Null admits. A trust verdict may need a snapshot read, so a gate may answer asynchronously; the built-in default never does. */
export type ProviderAdmissionGate = (providerId: string) => ProviderAdmissionRefusal | null | Promise<ProviderAdmissionRefusal | null>;

const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_PROVIDER_DESCRIPTORS.map(descriptor => descriptor.providerId));
const builtinsOnly: ProviderAdmissionGate = providerId => BUILTIN_IDS.has(providerId) ? null : "unknown-provider";
let gate = builtinsOnly;

/** The composition root installs the package-aware gate once; null restores the built-ins-only default (tests). */
export function installProviderAdmissionGate(next: ProviderAdmissionGate | null) { gate = next ?? builtinsOnly; }

/** Throws the Provider's named refusal; nothing of a refused Provider starts. A gate that fails is a refusal too, never a raw error. */
export async function assertProviderAdmitted(providerId: string): Promise<void> {
  let refusal: ProviderAdmissionRefusal | null;
  try { refusal = await gate(providerId); } catch (cause) {
    throw new ProviderAdmissionRefused(providerId, "gate-failed", cause instanceof Error ? cause.message : String(cause));
  }
  if (refusal) throw new ProviderAdmissionRefused(providerId, refusal);
}

/* d4c: a start that passed the (async) gate can still wait on a stopping bridge while a revocation lands; this synchronous check, from
   the same revoked mark, runs right before the bridge host is created, so such a start creates nothing. Unset: nothing is revoked. */
let revocation: ((providerId: string) => ProviderAdmissionRefusal | null) | null = null;
export function installProviderRevocationCheck(next: ((providerId: string) => ProviderAdmissionRefusal | null) | null) { revocation = next; }
export function assertProviderNotRevoked(providerId: string) {
  const refusal = revocation?.(providerId) ?? null;
  if (refusal) throw new ProviderAdmissionRefused(providerId, refusal);
}
