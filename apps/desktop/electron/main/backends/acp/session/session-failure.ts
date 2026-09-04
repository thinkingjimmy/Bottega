/**
 * [INPUT]: Depends on provider-neutral JetBrains AIR sessionFailure metadata, backend turn callbacks, a transport redactor, a turn-fact sink, and shared ProductFailure constructors
 * [OUTPUT]: Provides strict parsing, semantic projection, coarse terminal facts, monotonic revision tracking, callback-ready notice/terminal projection, and routing of the Codex skills-context-budget notice into the turn fact instead of a transcript item
 * [POS]: ACP session extension boundary; adapters may describe incidents, but only this file decides which product failure users see
 */

import type { FailureKind, UsageLimitInfo } from "../../../../../shared/agent-ipc";
import type { BackendTurnOptions } from "../../types";
import {
  agentRuntimeFailure,
  diagnosticFailureDetails,
  type AgentRuntimeFailureCode,
  type ProductFailure,
} from "../../../../../shared/product-failure";

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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function semanticCode(
  category: string,
  actions: readonly SessionFailureAction[]
): AgentRuntimeFailureCode {
  if (category === "access" || actions.includes("login")) return "auth-required";
  if (category === "connection") return "connection-lost";
  if (category === "request") return "request-rejected";
  if (category === "service") return "service-unavailable";
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
    failure: agentRuntimeFailure(
      semanticCode(category, actions),
      diagnosticFailureDetails(diagnostic)
    ),
  };
}

/* ── Codex skills 目录预算告警 ─────────────────────────────────────
   协商 typed sessionFailure 后，Codex 的 `warning` 通知经 codex-acp 以
   category:"unknown" / severity:"warning" 的 notice 到达，title 即原句。
   这一条说的是 Codex 自己的技能目录超预算、描述被截短，不是本轮故障：
   它只置位 turn 事实（→ skill-descriptions-truncated 软 notice），
   不进 agent-failure 条目。通知标题不是正文，子串匹配吞不掉 prose。 */
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
