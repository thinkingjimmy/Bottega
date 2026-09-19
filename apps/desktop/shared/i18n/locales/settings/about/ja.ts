/**
 * [INPUT]: Depends on the settingsAboutEn structural type
 * [OUTPUT]: Provides settingsAboutJa, the Japanese Settings › About catalog
 * [POS]: Japanese leaf of shared/i18n/locales/settings/about; loaded on demand by the matching top-level locale
 */

import type { settingsAboutEn } from "./en";

export const settingsAboutJa: typeof settingsAboutEn = {
  title: "Bottega について",
  tagline: "macOS Agent ワークスペース",
  version: "バージョン {{version}}",
  licenseName: "MIT License",
  readLicense: "MIT License を読む",
  licenseUnavailable: "パッケージ内のライセンスを読めません。公式コピーをオンラインで確認してください。",
  licenseCanonical: "公式コピーを開く",
  copy: "コピー",
  copied: "コピーしました",
  copyDiagnostics: "バージョン情報をコピー",
  links: "リンク",
  repository: "ソースリポジトリ",
  feedback: "問題を報告",
  feedbackDescription: "既知の問題を検索するか、新規に報告します",
  releaseNotes: "リリースノート",
  releaseNotesDescription: "各バージョンの変更点",
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
  backgroundFailedOpen: "更新の自動確認に失敗しています。詳細を開く",
  check: "更新を確認",
  upgrade: "今すぐ更新",
  manualUpgrade: "ダウンロードページを開く",
  checkedAt: " · {{time}} に確認",
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
