/**
 * [INPUT]: Depends on the settingsUsageEn structural type and usageLimitsZhCN from ../usage-limits
 * [OUTPUT]: Provides settingsUsageZhCN, the Simplified Chinese Settings › Usage catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/usage; loaded on demand by the matching top-level locale
 */

import type { settingsUsageEn } from "./en";
import { usageLimitsZhCN } from "../usage-limits";

export const settingsUsageZhCN: typeof settingsUsageEn = {
  limits: usageLimitsZhCN,
  today: "今天",
  allTime: "全时段",
  rawTokenCost: "Token 折算费用",
  rawTokenCostNote: "按 API 公开牌价折算",
  metric: "用量口径",
  metricCost: "费用",
  metricTokens: "Tokens",
  dailyChart: "最近 {{days}} 天的每日总量",
  shareOfToday: "占今天全部来源 {{total}} 的 {{percent}}",
  loading: "Usage 正在加载",
  readFailed: "无法读取本机 token 用量，请重试。",
  noDataTitle: "暂无本机用量数据",
  noDataDetail: "使用对应 CLI 开始一轮对话后，再刷新此页。",
  pricingTitle: "价格估算",
  pricingRefresh: "自动更新估算价格",
  pricingRefreshDescription:
    "进入本页时按 24 小时缓存周期检查 models.dev 牌价；关闭后只使用本机 seed 与既有缓存。",
  pricingRefreshAria: "自动更新 Usage 估算价格",
  pricingRefreshSaveFailed: "Usage 价格更新设置保存失败",
  refresh: "刷新用量",
  source: "用量来源",
  all: "全部",
  tokenActivity: "Token 活跃度",
  intensity: "Token 活跃强度",
  less: "少",
  more: "多",
  level: "强度 {{level}}",
  dailyTotals: "按 {{timeZone}} 统计的每日总量",
  dailyGrid: "最近 53 周的每日 token 活跃度",
  cellLabel: "{{date}}：{{tokens}} tokens · {{cost}}",
  costNote:
    "费用将本机订阅用量按 models.dev 当前公开 API 牌价折算；它不是账单，金额仅用于粗估 token 消耗，币种为 USD。",
};
