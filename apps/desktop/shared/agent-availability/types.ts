/**
 * [INPUT]: Depends on the shared backend and usage-limit identities.
 * [OUTPUT]: Provides availability facts, execution targets, scoped evidence and decisions.
 * [POS]: Serializable availability contract shared by registry and renderer projections.
 */
import type { AgentBackendId, HeadlessPurpose, UsageLimitInfo } from "../agent-ipc";

export const RUNTIME_TTL_MS = 60_000;
export const AUTH_TTL_MS = 5 * 60_000;
export const TURN_EVIDENCE_TTL_MS = AUTH_TTL_MS;

export type RuntimeIssue = "probe-failed" | "queue-timeout" | "identity-changed" | "cannot-start" | "unsupported";
export type CheckProgress = {
  phase: "queued" | "discovery" | "authentication" | "complete" | "error" | "cancelled";
  startedAt: number;
  checkedAt?: number;
  expiresAt?: number;
};
export type ConfirmedAuth = {
  id: string;
  revision: number;
  environmentGeneration: number;
  status: "authenticated" | "unauthenticated";
  checkedAt: number;
  expiresAt?: number;
  scopeKey?: string;
  supersededBy?: string;
};
export type ExecutionTarget = {
  backend: AgentBackendId;
  environmentGeneration: number;
  scopeKey?: string;
  model?: string;
  providerId?: string;
  configKey?: string;
};
export type TurnAvailabilityEvidence = {
  conversationId: string;
  requestId: string;
  target: ExecutionTarget;
  outcome: "success" | "auth-required" | "usage-limit" | "connection" | "service";
  startedAt: number;
  startedRevision?: number;
  checkedAt: number;
  expiresAt: number;
  revision: number;
  limit?: UsageLimitInfo;
};
export type AvailabilityDecision = {
  decision: "allow" | "wait" | "block";
  reason?: "checking" | "missing" | "unsupported" | "cannot-check" | "cannot-start" | "auth-required" | "auth-unknown" | "usage-limit";
};
export type PurposeEligibility = Partial<Record<HeadlessPurpose | "app-binding", AvailabilityDecision & { expiresAt?: number }>>;
export type AvailabilityFacts = {
  revision: number;
  environmentGeneration: number;
  probeGeneration: number;
  capabilityKnowledge: "unknown" | "known";
  runtimeIssue?: RuntimeIssue;
  runtimeCheck?: CheckProgress;
  authCheck?: CheckProgress;
  lastConfirmedAuth?: ConfirmedAuth;
  purposeEligibility?: PurposeEligibility;
};

/** A request to try one operation; main binds the evidence and execution identity. */
export type AuthenticationRetryIntent = { kind: "retry-authentication" };

export type AvailabilityState = "recent-sign-in" | "connection" | "service" | "checking" | "ready" | "unverified" | "missing" | "unsupported" | "sign-in" | "cannot-check" | "cannot-start" | "usage-limit";
