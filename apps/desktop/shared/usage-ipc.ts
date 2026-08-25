/**
 * [INPUT]: No external dependence; The user source domain is self-identified and is being transferred to the back-end registered domain of agent-ipc
 * [OUTPUT]: Provides Usage Source domain subgroup/identity, query target, token/cost statistics, price revision, push, scan progress DTO and preload bridge agreement
 * [POS]: IPC single truth source, connecting Electron main, preload and renderer
 */

/* ============================================================
 * 用量源域 ≠ 后端注册域。接入一个新 Agent 后端不等于它有本地
 * 用量账本：源必须落盘可解析的 JSONL 且已完成价格对账，才有资格
 * 进这张表。故此处是独立元组，绝不从 AGENT_BACKEND_ORDER 派生。
 * ============================================================ */
export const USAGE_SOURCE_ORDER = ["codex", "claude", "kimi"] as const;
export type UsageSourceId = (typeof USAGE_SOURCE_ORDER)[number];

export const USAGE_QUERY_TARGETS = ["all", ...USAGE_SOURCE_ORDER] as const;
export type UsageQueryTarget = (typeof USAGE_QUERY_TARGETS)[number];

export type DailyTokens = Record<string, number>;

export type UsageStats = {
  lifetimeTokens: number;
  lifetimeCostUsd: number;
  peakDayTokens: number;
  peakDay: string | null;
  longestChatMs: number;
  currentStreakDays: number;
  longestStreakDays: number;
};

export type UsageIssue = {
  source: UsageSourceId;
  kind: "source" | "file" | "line" | "cache";
  affectsSummary: boolean;
  failedFiles: number;
  failedLines: number;
  message: string;
};

export type AgentUsageSummary = {
  target: UsageQueryTarget;
  status: "ok" | "partial" | "no-data" | "error";
  stats: UsageStats;
  daily: DailyTokens;
  dailyCostUsd: Record<string, number>;
  dailyUnpricedTokens: Record<string, number>;
  pricingRevision: number;
  timeZone: string;
  todayKey: string;
  scannedFiles: number;
  issues: UsageIssue[];
};

export type UsageScanProgress = {
  source: UsageSourceId;
  scanId: number;
  phase: "start" | "progress" | "done";
  outcome?: "ok" | "cancelled" | "error";
  scanned: number;
  total: number;
};

export type UsagePricingUpdate = {
  pricingRevision: number;
};

export const USAGE_CHANNEL = {
  getSummary: "usage:get-summary",
  scanProgress: "usage:scan-progress",
  pricingUpdated: "usage:pricing-updated",
  replayProgress: "usage:replay-progress",
} as const;

export type UsageBridgeApi = {
  getSummary: (
    target: UsageQueryTarget,
    opts?: { forceRefresh?: boolean }
  ) => Promise<AgentUsageSummary>;
  onScanProgress: (cb: (progress: UsageScanProgress) => void) => () => void;
  onPricingUpdated: (cb: (update: UsagePricingUpdate) => void) => () => void;
};
