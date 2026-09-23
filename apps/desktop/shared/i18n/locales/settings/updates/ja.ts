/**
 * [INPUT]: Depends on the settingsUpdatesEn structural type
 * [OUTPUT]: Provides settingsUpdatesJa, the Japanese Settings › Updates catalog
 * [POS]: Japanese leaf of shared/i18n/locales/settings/updates; loaded on demand by the matching top-level locale
 */

import type { settingsUpdatesEn } from "./en";

export const settingsUpdatesJa: typeof settingsUpdatesEn = {
  title: "アップデート",
  description: "Bottega と各プロバイダー CLI のアップデートを管理します。",
  updateAll: "すべてアップデート",
  updateOne: "{{name}} をアップデート",
  upToDate: "{{name}} は最新です",
  updating: "{{name}} をアップデート中…",
  latestUnknown: "最新バージョン不明",
  cliFailed: "アップデートに失敗しました",
  cliUnchanged: "アップデーターは終了しましたが、バージョンが変わっていません。ターミナルでのアップデートをお試しください。",
  cliTimeout: "アップデートに時間がかかりすぎたため停止しました。",
  cliUnavailable: "この CLI はここからアップデートできません。",
  retry: "再試行",
  log: "ログ",
  terminal: "ターミナルでアップデート",
  empty: "プロバイダー CLI はまだインストールされていません。",
  checking: "更新を確認中…",
  current: "最新です{{checkedAt}}",
  available: "バージョン {{version}} を利用できます",
  downloading: "{{version}} をダウンロード中",
  installing: "更新をダウンロードしました · 再起動してインストールします",
  failed: "更新に失敗しました: {{message}}",
  failedUnknown: "不明な理由で更新に失敗しました。",
  failedFallback:
    "自動更新を完了できませんでした。Releases ページを開いてバージョン {{version}} をダウンロードしてください。",
  failedResolution:
    "Releases ページから新しいバージョンをダウンロードするか、GitHub で問題を報告してください。",
  backgroundFailed: "前回の自動確認に失敗しました",
  backgroundFailedOpen: "自動アップデート確認が失敗しています。詳細はアップデートを開いてください",
  check: "更新を確認",
  upgrade: "今すぐ更新",
  manualUpgrade: "ダウンロードページを開く",
  unavailable: "更新サービスはパッケージ版で利用できます",
  platformSupport: "プラットフォームサポート",
  preview: "{{platform}} プレビュー",
  previewDescription:
    "パッケージ、起動、更新に対応しています。OS の custody と sandbox 契約が完了するまで次の機能は無効です:",
  features: {
    agentTurns: "Agent 会話",
    headlessSandbox: "ヘッドレス Agent タスク",
    ownedGitMutation: "管理対象 Git 変更",
    serverApps: "server Apps",
    chromeImport: "Chrome ログインの取り込み",
    memory: "管理対象 Memory",
  },
};
