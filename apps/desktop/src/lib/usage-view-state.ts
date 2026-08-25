/**
 * [INPUT]: Depends on shared Usage Source domain subgroup, Summary/Progress type
 * [OUTPUT]: Provides full target revision+seq+generation Unified block, price, floor derivative status and progress reducer
 * [POS]: The renderer Usage is the pure state kernel; generation attribution, revision/seq attribution, all Summary responses to common rules
 */

import {
  USAGE_QUERY_TARGETS,
  type AgentUsageSummary,
  type UsageQueryTarget,
  type UsageScanProgress,
  type UsageSourceId,
} from "../../shared/usage-ipc";

export type UsageStatus = "loading" | "ready" | "error";
export type UsageSummaries = Record<UsageQueryTarget, AgentUsageSummary | null>;
export type UsageSourceNotes = Partial<Record<UsageQueryTarget, string>>;
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
  if (action.generation !== state.generation) return state;
  if (action.type === "rejected") {
    if (state.pending === 0) return state;
    return { ...state, pending: state.pending - 1, failed: true };
  }

  const settlesPending = action.type === "resolved" && state.pending > 0;
  const accepted = shouldApply(state, action);
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
 * 缓存类问题不影响任何数字，只解释「这次为什么重扫」。它属于
 * 具体那一个源，于是按 source 归一：同源多条只留最后一条，
 * 视图拿到的就是「每个源最多一句注解」，没有列表、没有折叠。
 * 跨 target 汇总让注解不随当前选中的 tab 忽隐忽现。
 * ============================================================ */

export function usageCacheNotes(summaries: UsageSummaries): UsageSourceNotes {
  return Object.fromEntries(
    Object.values(summaries)
      .flatMap((summary) => summary?.issues ?? [])
      .filter((issue) => issue.kind === "cache")
      .map((issue) => [issue.source, issue.message])
  );
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
