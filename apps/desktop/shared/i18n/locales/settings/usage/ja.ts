/**
 * [INPUT]: Depends on the settingsUsageEn structural type and usageLimitsJa from ../usage-limits
 * [OUTPUT]: Provides settingsUsageJa, the Japanese Settings › Usage catalog
 * [POS]: Japanese leaf of shared/i18n/locales/settings/usage; loaded on demand by the matching top-level locale
 */

import type { settingsUsageEn } from "./en";
import { usageLimitsJa } from "../usage-limits";

export const settingsUsageJa: typeof settingsUsageEn = {
  limits: usageLimitsJa,
  today: "今日",
  allTime: "全期間",
  rawTokenCost: "Token 換算費用",
  rawTokenCostNote: "API 公開価格で換算した場合",
  metric: "使用量の指標",
  metricCost: "費用",
  metricTokens: "Tokens",
  dailyChart: "過去 {{days}} 日間の日別合計",
  shareOfToday: "今日の全ソース {{total}} の {{percent}}",
  loading: "使用量を読み込み中",
  readFailed: "ローカルの token 使用量を読み込めませんでした。再試行してください。",
  noDataTitle: "ローカル使用量データはまだありません",
  noDataDetail: "対応する CLI で会話を開始してから、このページを更新してください。",
  pricingTitle: "推定価格",
  pricingRefresh: "推定価格を自動更新",
  pricingRefreshDescription:
    "このページを開くと 24 時間のキャッシュ周期で models.dev の価格を確認します。オフではローカル seed と既存キャッシュだけを使います。",
  pricingRefreshAria: "Usage の推定価格を自動更新",
  pricingRefreshSaveFailed: "Usage の価格更新設定を保存できませんでした",
  refresh: "使用量を更新",
  source: "使用量ソース",
  all: "すべて",
  tokenActivity: "Token アクティビティ",
  intensity: "Token アクティビティの強度",
  less: "少",
  more: "多",
  level: "レベル {{level}}",
  dailyTotals: "{{timeZone}} での日別合計",
  dailyGrid: "過去 53 週間の日別 token アクティビティ",
  cellLabel: "{{date}}：{{tokens}} tokens・{{cost}}",
  costNote:
    "費用はローカルのサブスクリプション使用量を models.dev の公開 API 価格で換算したものです。請求額ではなく、token 消費を USD で概算するための参考値です。",
};
