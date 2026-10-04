/**
 * [INPUT]: Depends on Zod only.
 * [OUTPUT]: Provides the eight trusted facts, the evidence kinds that may establish each, establishFact (rejecting the listed inferences) and unknownEventPolicy.
 * [POS]: Semantic guard shared by broker adapters, Provider bridges and Workflow; it names what a signal proves so no layer upgrades "sent" into "done".
 */
import { z } from "zod";

/* ============================================================
 * Each fact, the evidence that proves it, and the
 * nearby signal that must never be read as proof.
 * ============================================================ */
export const TRUSTED_FACTS = Object.freeze({
  "input-recorded": { proves: ["durable-input"], neverFrom: ["model-read"] },
  "transport-committed": { proves: ["transport-ack", "protocol-accepted"], neverFrom: ["consumed", "task-complete"] },
  running: { proves: ["live-process", "native-running-event"], neverFrom: ["presence-online"] },
  "native-terminal": { proves: ["native-terminal-event"], neverFrom: ["base-status", "model-claim"] },
  stopped: { proves: ["process-exit", "custody-released"], neverFrom: ["cancel-sent"] },
  "native-resumed": { proves: ["native-session-resume"], neverFrom: ["new-session-replay"] },
  "result-verified": { proves: ["check-executed"], neverFrom: ["schema-valid", "agent-claim"] },
  "business-done": { proves: ["business-transition"], neverFrom: ["turn-terminal"] },
} as const);
export type TrustedFact = keyof typeof TRUSTED_FACTS;
export type FactEvidenceKind = (typeof TRUSTED_FACTS)[TrustedFact]["proves"][number] | (typeof TRUSTED_FACTS)[TrustedFact]["neverFrom"][number];

export const factEvidenceSchema = z.object({
  kind: z.string().min(1).max(64),
  /** Reference to the native record that carries the evidence (receipt id, custody id, event seq). */
  ref: z.string().min(1).max(256),
  observedAt: z.number().int().min(0),
}).strict();
export type FactEvidence = z.infer<typeof factEvidenceSchema>;

export class UntrustedInferenceError extends Error {
  readonly name = "UntrustedInferenceError";
  constructor(readonly fact: TrustedFact, readonly evidenceKind: string) {
    super(`fact "${fact}" cannot be established from "${evidenceKind}"`);
  }
}

/** Returns the evidence when it proves the fact; throws for a listed inference and for any unknown kind. */
export function establishFact(fact: TrustedFact, evidence: FactEvidence): FactEvidence {
  const value = factEvidenceSchema.parse(evidence);
  const rule = TRUSTED_FACTS[fact];
  if (!rule) throw new Error("trusted-fact-unknown");
  if (!(rule.proves as readonly string[]).includes(value.kind)) throw new UntrustedInferenceError(fact, value.kind);
  return value;
}

/**
 * Unknown native events: anything that could change permission, result or progress is refused or
 * blocks; only a purely presentational event may fall back to safe text.
 */
export type UnknownEventImpact = "permission" | "result" | "advance" | "display";
export function unknownEventPolicy(impact: UnknownEventImpact): "reject" | "block" | "safe-text" {
  if (impact === "permission") return "reject";
  if (impact === "result" || impact === "advance") return "block";
  return "safe-text";
}
