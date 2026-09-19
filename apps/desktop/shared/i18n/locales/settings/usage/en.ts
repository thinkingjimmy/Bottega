/**
 * [INPUT]: Depends on usageLimitsEn from ../usage-limits
 * [OUTPUT]: Provides settingsUsageEn — Settings Usage and composer quota details, composing the matching usage-limits catalog — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/usage; dynamic CLI diagnostics are not translated
 */

import { usageLimitsEn } from "../usage-limits";

export const settingsUsageEn = {
  limits: usageLimitsEn,
  today: "Today",
  allTime: "All time",
  rawTokenCost: "Raw token cost",
  rawTokenCostNote: "If billed at API list prices",
  metric: "Usage metric",
  metricCost: "Cost",
  metricTokens: "Tokens",
  dailyChart: "Daily totals for the last {{days}} days",
  shareOfToday: "{{percent}} of today’s {{total}} across all sources",
  loading: "Usage is loading",
  readFailed: "Could not read local token usage. Try again.",
  noDataTitle: "No local usage data yet",
  noDataDetail: "Start a conversation with the corresponding CLI, then refresh this page.",
  pricingTitle: "Estimated pricing",
  pricingRefresh: "Automatically update estimated prices",
  pricingRefreshDescription:
    "When this page opens, check models.dev prices on a 24-hour cache cycle. When off, use only the local seed and existing cache.",
  pricingRefreshAria: "Automatically update Usage estimated prices",
  pricingRefreshSaveFailed: "Failed to save the Usage price update setting",
  refresh: "Refresh usage",
  source: "Usage source",
  all: "All",
  tokenActivity: "Token activity",
  intensity: "Token activity intensity",
  less: "Less",
  more: "More",
  level: "Level {{level}}",
  dailyTotals: "Daily totals in {{timeZone}}",
  dailyGrid: "Daily token activity for the last 53 weeks",
  cellLabel: "{{date}}: {{tokens}} tokens · {{cost}}",
  costNote:
    "Costs convert local subscription usage using current public API prices from models.dev. They are not a bill and are only a rough USD estimate of token consumption.",
};
