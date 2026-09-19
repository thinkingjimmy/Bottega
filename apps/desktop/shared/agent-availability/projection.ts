/**
 * [INPUT]: Depends on immutable backend snapshots, scoped evidence and an explicit clock.
 * [OUTPUT]: Provides shared admission and display judgments that preserve startup blockers and respect runtime/authentication evidence lifetimes.
 * [POS]: Pure decision authority for main admission and every renderer availability surface.
 */
import type { BackendInfo } from "../agent-ipc";
import type { AvailabilityDecision, AvailabilityState, ConfirmedAuth, ExecutionTarget, TurnAvailabilityEvidence } from "./types";

export function matchesTarget(left: ExecutionTarget, right: ExecutionTarget) {
  return left.backend === right.backend && left.environmentGeneration === right.environmentGeneration &&
    left.scopeKey === right.scopeKey && left.model === right.model &&
    left.providerId === right.providerId && left.configKey === right.configKey;
}

/** Missing provider/config identity supports a local hint, never a target-wide quota denial. */
export function matchesTurnHint(recent: TurnAvailabilityEvidence, conversationId?: string, target?: ExecutionTarget) {
  return Boolean(target && recent.conversationId === conversationId &&
    recent.target.backend === target.backend && recent.target.environmentGeneration === target.environmentGeneration &&
    recent.target.model === target.model &&
    (!target.providerId || !recent.target.providerId || recent.target.providerId === target.providerId) &&
    (!target.configKey || !recent.target.configKey || recent.target.configKey === target.configKey) &&
    (!target.scopeKey || !recent.target.scopeKey || recent.target.scopeKey === target.scopeKey));
}

export function activeNegative(auth: ConfirmedAuth | undefined, environmentGeneration: number, scopeKey?: string) {
  return auth?.status === "unauthenticated" && !auth.supersededBy &&
    auth.environmentGeneration === environmentGeneration &&
    (!scopeKey || !auth.scopeKey || scopeKey === auth.scopeKey) ? auth : undefined;
}

export function positiveAuth(auth: ConfirmedAuth | undefined, environmentGeneration: number, now: number, scopeKey?: string) {
  return Boolean(auth?.status === "authenticated" && auth.environmentGeneration === environmentGeneration &&
    auth.expiresAt !== undefined && auth.expiresAt > now &&
    (!scopeKey || !auth.scopeKey || scopeKey === auth.scopeKey));
}

type BackendFacts = Pick<BackendInfo, "runtimeStatus" | "authStatus" | "availability">;
export function submissionDecision(info: BackendFacts | undefined, now: number, context?: {
  target?: ExecutionTarget;
  conversationId?: string;
  recent?: TurnAvailabilityEvidence;
}): AvailabilityDecision {
  if (!info || info.runtimeStatus === "unknown") return { decision: "wait", reason: "checking" };
  if (info.runtimeStatus === "missing") return { decision: "block", reason: "missing" };
  if (info.runtimeStatus === "unsupported") return { decision: "block", reason: "unsupported" };
  if (info.runtimeStatus === "error") return {
    decision: "block", reason: info.availability?.runtimeIssue === "cannot-start" ? "cannot-start" : "cannot-check",
  };
  const facts = info.availability;
  if (facts?.startup?.status === "cannot-start" && facts.startup.environmentGeneration === facts.environmentGeneration) {
    return { decision: "block", reason: "cannot-start" };
  }
  if (facts?.runtimeCheck?.phase === "error" && (facts.runtimeCheck.expiresAt ?? 0) <= now) {
    return { decision: "block", reason: "cannot-check" };
  }
  const recent = context?.recent;
  if (recent?.outcome === "usage-limit" && recent.limit?.resetsAt && recent.limit.resetsAt > now &&
    recent.conversationId === context?.conversationId && context.target &&
    Boolean(context.target.scopeKey || (context.target.providerId && context.target.model && context.target.configKey)) && matchesTarget(recent.target, context.target)) {
    return { decision: "block", reason: "usage-limit" };
  }
  if (facts ? activeNegative(facts.lastConfirmedAuth, facts.environmentGeneration, context?.target?.scopeKey)
    : info.authStatus === "unauthenticated") return { decision: "block", reason: "auth-required" };
  return { decision: "allow" };
}

export function projectAvailability(info: BackendFacts | undefined, now: number, context?: Parameters<typeof submissionDecision>[2]) {
  const policy = submissionDecision(info, now, context);
  let state: AvailabilityState = "unverified";
  if (policy.reason === "auth-required") state = "sign-in";
  else if (policy.reason && policy.reason !== "auth-unknown") state = policy.reason;
  else if (info) {
    const facts = info.availability;
    const recent = context?.recent;
    const localSuccess = recent?.outcome === "success" && recent.expiresAt > now &&
      recent.conversationId === context?.conversationId && context.target && matchesTarget(recent.target, context.target);
    const localFailure = recent && recent.outcome !== "success" && recent.expiresAt > now &&
      matchesTurnHint(recent, context?.conversationId, context?.target);
    if (localFailure) state = recent.outcome === "auth-required" ? "recent-sign-in" : recent.outcome === "usage-limit" ? "usage-limit" : recent.outcome as "connection" | "service";
    else if (localSuccess || (facts ? positiveAuth(facts.lastConfirmedAuth, facts.environmentGeneration, now, context?.target?.scopeKey)
      : info.authStatus === "authenticated")) state = "ready";
  }
  const phase = info?.availability?.authCheck?.phase ?? info?.availability?.runtimeCheck?.phase;
  return { state, policy, refreshing: phase === "queued" || phase === "discovery" || phase === "authentication" };
}
