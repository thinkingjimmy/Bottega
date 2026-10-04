/**
 * [INPUT]: Depends on shared Usage Source domain subgroup, Summary/Progress type
 * [OUTPUT]: Provides UsageViewState/UsageProgressState types plus usageViewReducer/usageProgressReducer, unifying per-target revision+seq+generation fencing, pricing revision, and scan-progress state, and the grouped warnings for usage that is really missing
 * [POS]: apps/desktop/src/lib/usage; Pure state kernel for renderer Usage; generation and revision/seq fencing apply the same rule to every summary response, except that any response fills a tab with nothing on screen
 */

import {
  USAGE_QUERY_TARGETS,
  type AgentUsageSummary,
  type UsageIssue,
  type UsageQueryTarget,
  type UsageScanProgress,
  type UsageSourceId,
} from "../../../shared/ipc/settings/usage-ipc";

export type UsageStatus = "loading" | "ready" | "error";
export type UsageSummaries = Record<UsageQueryTarget, AgentUsageSummary | null>;
export type AppliedSummary = { revision: number; seq: number };

export type UsageViewState = {
  generation: number;
  pending: number;
  failed: boolean;
  summaries: UsageSummaries;
  applied: Record<UsageQueryTarget, AppliedSummary>;
  knownPricingRevision: number;
};

export type UsageProgressState = Partial<Record<UsageSourceId, UsageScanProgress>>;

type SummaryAction = {
  generation: number;
  target: UsageQueryTarget;
  seq: number;
  summary: AgentUsageSummary;
};

export type UsageViewAction =
  | { type: "load-started"; generation: number }
  | ({ type: "resolved" | "revalidated" } & SummaryAction)
  | { type: "rejected"; generation: number }
  | { type: "pricing-known"; pricingRevision: number };

export const USAGE_TARGETS = USAGE_QUERY_TARGETS;
export const FIRST_USAGE_GENERATION = 1;

/** target 侧初值一律由源域元组铺开：新增用量源不必再手写四张同构表。 */
export const usageTargetRecord = <T,>(value: () => T) =>
  Object.fromEntries(USAGE_TARGETS.map((target) => [target, value()])) as Record<
    UsageQueryTarget,
    T
  >;

export function createUsageViewState(): UsageViewState {
  return {
    generation: FIRST_USAGE_GENERATION,
    pending: USAGE_TARGETS.length,
    failed: false,
    summaries: usageTargetRecord<AgentUsageSummary | null>(() => null),
    applied: usageTargetRecord<AppliedSummary>(() => ({
      revision: -1,
      seq: -1,
    })),
    knownPricingRevision: 0,
  };
}

function shouldApply(state: UsageViewState, action: SummaryAction) {
  if (action.summary.pricingRevision < state.knownPricingRevision) return false;
  const applied = state.applied[action.target];
  return (
    action.summary.pricingRevision > applied.revision ||
    (action.summary.pricingRevision === applied.revision &&
      action.seq > applied.seq)
  );
}

export function usageViewReducer(
  state: UsageViewState,
  action: UsageViewAction
): UsageViewState {
  if (action.type === "pricing-known") {
    if (action.pricingRevision <= state.knownPricingRevision) return state;
    return { ...state, knownPricingRevision: action.pricingRevision };
  }
  if (action.type === "load-started") {
    if (action.generation <= state.generation) return state;
    return {
      ...state,
      generation: action.generation,
      pending: USAGE_TARGETS.length,
      failed: false,
    };
  }
  if (action.type === "rejected") {
    if (action.generation !== state.generation || state.pending === 0) return state;
    return { ...state, pending: state.pending - 1, failed: true };
  }

  /* A response from an older refresh, or priced under a table since replaced, still beats an empty tab: the numbers were read,
     and the rescan the newer refresh or price push started replaces them. Once a tab shows numbers, only newer ones win. */
  const current = action.generation === state.generation;
  const empty = state.summaries[action.target] === null;
  if (!current && !empty) return state;
  const settlesPending = current && action.type === "resolved" && state.pending > 0;
  const accepted = empty || shouldApply(state, action);
  if (!settlesPending && !accepted) return state;
  const pending = settlesPending ? state.pending - 1 : state.pending;
  if (!accepted) return { ...state, pending };
  const revision = action.summary.pricingRevision;
  return {
    ...state,
    pending,
    knownPricingRevision: Math.max(state.knownPricingRevision, revision),
    summaries: { ...state.summaries, [action.target]: action.summary },
    applied: {
      ...state.applied,
      [action.target]: { revision, seq: action.seq },
    },
  };
}

/* ============================================================
 * Only usage that is really missing from the numbers is said: a log folder or log files that could not be read. A rebuilt
 * or unsaved cache changes no number, and a damaged entry cannot be repaired by anyone reading this page, so neither is shown
 * (the issues still carry them for diagnostics). One warning per Agent and kind of loss, never one per file: counts add up.
 * ============================================================ */

export function usageIssueWarnings(issues: readonly UsageIssue[]) {
  const warnings = new Map<string, { source: UsageIssue["source"]; key: string; count: number }>();
  for (const issue of issues) {
    if (!issue.affectsSummary || (issue.kind !== "source" && issue.kind !== "file")) continue;
    const issueKey = issue.kind === "source" ? "settings.usage.issues.sourceUnreadable" : "settings.usage.issues.filesUnreadable";
    const count = issue.kind === "source" ? 0 : issue.failedFiles;
    const id = `${issue.source}:${issueKey}`;
    const current = warnings.get(id);
    if (current) current.count += count; else warnings.set(id, { source: issue.source, key: issueKey, count });
  }
  return [...warnings.values()];
}

export function usageStatus(state: UsageViewState): UsageStatus {
  if (state.pending > 0) return "loading";
  return state.failed && !state.summaries.all ? "error" : "ready";
}

export function usageProgressReducer(
  state: UsageProgressState,
  progress: UsageScanProgress
): UsageProgressState {
  const current = state[progress.source];
  if (current && current.scanId > progress.scanId) return state;
  if (progress.phase === "done") {
    if (!current || current.scanId <= progress.scanId) {
      const next = { ...state };
      delete next[progress.source];
      return next;
    }
    return state;
  }
  return { ...state, [progress.source]: progress };
}
