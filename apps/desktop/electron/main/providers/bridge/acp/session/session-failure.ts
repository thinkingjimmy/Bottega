/**
 * [INPUT]: Depends on provider-neutral JetBrains AIR sessionFailure metadata, backend turn callbacks, a transport redactor, a turn-fact sink, shared ProductFailure constructors, and the acp/failure record guard
 * [OUTPUT]: Provides strict parsing, semantic projection (a rejected Claude API key stays auth-required with an api-key requirement), coarse terminal facts, monotonic revision tracking, callback-ready notice/terminal projection, and routing of compatible skills-context-budget notices into the turn fact instead of a transcript item
 * [POS]: ACP session extension boundary; adapters may describe incidents, but only this file decides which product failure users see
 */

import type { FailureKind, UsageLimitInfo } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { BackendTurnOptions } from "../../../../backends/contracts/types";
import { record } from "../../../../backends/acp/failure";
import {
  agentRuntimeFailure,
  diagnosticFailureDetails,
  type AgentRuntimeFailureCode,
  type ProductFailure,
} from "../../../../../../shared/product/product-failure";

const CATEGORIES = new Set([
  "connection",
  "access",
  "limit",
  "request",
  "service",
  "unknown",
]);
const SEVERITIES = new Set(["warning", "error"]);
const ACTIONS = new Set(["retry", "login", "new_session"]);

type SessionFailureAction = "retry" | "login" | "new_session";

export type AcpSessionFailure = Readonly<{
  id: string;
  revision: number;
  severity: "warning" | "error";
  actions: readonly SessionFailureAction[];
  failure: ProductFailure;
}>;

/* ── A rejected API key is not a login to redo (TASK-13 E) ─────────────
   claude-agent-acp fails a login-less turn with authRequired and carries the CLI's own synthetic text as the title; that text
   opening with "Invalid API key" (the same fixed wording `claude auth status` prints) means the key or gateway token was
   rejected. It stays auth-required, with a requirement detail that chooses the API-key copy. */
const API_KEY_REJECTED = /^invalid api key\b/i;

function semanticCode(
  category: string,
  actions: readonly SessionFailureAction[],
  _diagnostic: string
): AgentRuntimeFailureCode {
  if (category === "access" || actions.includes("login")) return "auth-required";
  if (category === "connection") return "connection-lost";
  if (category === "request" || category === "service") {
    return category === "request" ? "request-rejected" : "service-unavailable";
  }
  if (category !== "limit") return "unknown";
  if (actions.includes("new_session")) return "context-exhausted";
  return actions.includes("retry") ? "rate-limited" : "quota-exhausted";
}

/** Unknown actions are ignored as required by the extension; malformed core
 * identity/category/severity fields fail closed and fall back to legacy ACP. */
export function parseAcpSessionFailure(meta: unknown): AcpSessionFailure | undefined {
  const root = record(meta);
  const jetbrains = record(root?.jetbrains);
  const air = record(jetbrains?.air);
  const value = record(air?.sessionFailure);
  if (!value || !Number.isInteger(air?.version) || Number(air?.version) < 1) {
    return undefined;
  }
  const { id, revision, category, severity, title, details } = value;
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 220 ||
    !Number.isInteger(revision) ||
    Number(revision) < 1 ||
    typeof category !== "string" ||
    !CATEGORIES.has(category) ||
    typeof severity !== "string" ||
    !SEVERITIES.has(severity) ||
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 1_000 ||
    (details !== undefined && typeof details !== "string") ||
    !Array.isArray(value.actions)
  ) {
    return undefined;
  }
  const actions = value.actions.filter(
    (action): action is SessionFailureAction =>
      typeof action === "string" && ACTIONS.has(action)
  );
  const diagnostic = details ? `${title}\n${details}` : title;
  return {
    id,
    revision: Number(revision),
    severity: severity as "warning" | "error",
    actions,
    failure: semanticCode(category, actions, diagnostic) === "auth-required" && API_KEY_REJECTED.test(title.trim())
      ? agentRuntimeFailure("auth-required", { version: 1, kind: "requirement", requirement: "api-key" })
      : agentRuntimeFailure(semanticCode(category, actions, diagnostic), diagnosticFailureDetails(diagnostic)),
  };
}

/* Compatible ACP Skill-budget notices set a durable turn fact rather than a failure item. */
const SKILLS_CONTEXT_BUDGET_MARKER = "skills context budget";

export function isSkillsContextBudgetNotice(failure: AcpSessionFailure) {
  return (
    failure.severity === "warning" &&
    failure.failure.safeDetails.kind === "diagnostic" &&
    failure.failure.safeDetails.message.includes(SKILLS_CONTEXT_BUDGET_MARKER)
  );
}

export function terminalFactsForSessionFailure(failure: ProductFailure): {
  failureKind: FailureKind;
  usageLimit?: UsageLimitInfo;
} {
  if (failure.domain !== "agent-runtime") return { failureKind: "unknown" };
  if (failure.code === "auth-required") return { failureKind: "auth-required" };
  if (failure.code === "rate-limited") {
    return { failureKind: "usage-limit", usageLimit: { window: "provider" } };
  }
  if (failure.code === "quota-exhausted") {
    return { failureKind: "usage-limit", usageLimit: { window: "unknown" } };
  }
  return { failureKind: "unknown" };
}

export class AcpSessionFailureTracker {
  private readonly revisions = new Map<string, number>();

  accept(meta: unknown): AcpSessionFailure | undefined {
    const failure = parseAcpSessionFailure(meta);
    if (!failure) return undefined;
    const previous = this.revisions.get(failure.id) ?? 0;
    if (failure.revision <= previous) return undefined;
    this.revisions.set(failure.id, failure.revision);
    return failure;
  }
}

type SessionFailureCallbacks = Pick<
  BackendTurnOptions["callbacks"],
  "onItem" | "onItemRemoved"
>;

export class AcpSessionFailureProjection {
  private readonly tracker = new AcpSessionFailureTracker();

  constructor(
    private readonly callbacks: SessionFailureCallbacks,
    private readonly redact: (message: string) => string,
    private readonly onSkillDescriptionsTruncated: () => void
  ) {}

  projectPrompt(meta: unknown): ProductFailure | undefined {
    const failure = parseAcpSessionFailure(meta);
    if (!failure) return undefined;
    if (failure.severity === "error") {
      this.callbacks.onItemRemoved(`agent-failure:${failure.id}`);
      return this.redactFailure(failure.failure);
    }
    this.emit(failure);
    return undefined;
  }

  projectUpdate(meta: unknown) {
    const failure = this.tracker.accept(meta);
    if (!failure) return;
    if (isSkillsContextBudgetNotice(failure)) {
      this.onSkillDescriptionsTruncated();
      return;
    }
    this.emit(failure);
  }

  private emit(failure: AcpSessionFailure) {
    this.callbacks.onItem({
      itemId: `agent-failure:${failure.id}`,
      kind: "agent-failure",
      title: "Agent notice",
      status: failure.severity === "error" ? "failed" : "completed",
      severity: failure.severity,
      failure: this.redactFailure(failure.failure),
    });
  }

  private redactFailure(failure: ProductFailure): ProductFailure {
    if (
      failure.domain !== "agent-runtime" ||
      failure.safeDetails.kind !== "diagnostic"
    ) {
      return failure;
    }
    return agentRuntimeFailure(
      failure.code,
      diagnosticFailureDetails(this.redact(failure.safeDetails.message))
    );
  }
}
