/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingJa, the Japanese two-step Onboarding and Chat Skills prompt catalog
 * [POS]: Japanese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingJa: typeof onboardingEn = {
  heading: { "chat-home": "{{product}} のファイルはどこに置きますか？", agent: "Agent を設定" },
  description: {
    "chat-home": "チャット、ファイル、Skills は、あなたが所有する 1 つのフォルダーに保存されます。どちらの場合も、アカウント設定、鍵、端末の権限はこのコンピューターに残ります。",
    agent: "{{product}} はこのコンピューター上のコーディング Agent を通じて動作します。1 つ以上インストールすると次へ進めます。残りはいつでも Settings › Providers から追加できます。",
  },
  next: "次へ", start: "使い始める",
  folder: {
    aria: "ファイルの保存先",
    fresh: "新しく始める", recommended: "おすすめ", freshDetail: "{{path}} を作成します。",
    found: "続きから再開", foundBadge: "見つかりました", foundDetail: "{{path}} にはすでに {{product}} のチャットとファイルがあります。",
    choose: "フォルダーを選択…", chooseDetail: "新規でも既存でも、{{product}} が判別します。",
  },
  opening: "開いています…",
  folderProgress: { opening: "ファイルを開いています… {{completed}} / {{total}}", saving: "ファイルを保存しています… {{completed}} / {{total}}" },
  agentLater: "後でインストール",
  agentLaterFailed: "この選択を保存できませんでした。もう一度お試しください。",
  agentInstalled: "インストール済み",
  agentChecking: "確認中…",
  agentInstalling: "インストール待ち…",
  agentCheckFailed: "インストールを確認できませんでした。再試行してください。",
  agentAbout: { codex: "OpenAI のコーディング Agent", claude: "Anthropic のコーディング Agent", kimi: "Moonshot のコーディング Agent", opencode: "オープンソース、好きなモデルを利用可能" },
  preview: {
    project: "Bottega Site",
    chats: { releaseNotes: "リリースノートを公開", settingsPanel: "設定パネルを移行", changelog: "更新履歴を作成", importTests: "CLI import 経路をカバー", onboarding: "Onboarding 文を短縮", iconGrid: "2 つのアイコングリッドを比較", acp: "ACP ハンドシェイクを説明" },
    priorAsk: "0.1.9 以降にマージされた PR のうち、ユーザーが実際に気づくのはどれ？",
    priorReply: "18 件のうち 6 件。Agent の足並みが揃ったことが最初に伝わります。内部のリファクタリング 2 件は一行にまとめます。",
    ask: "0.1.9 以降にマージされた PR から 0.2.0 のリリースノートを作成して。",
    workedFor: "作業時間 {{duration}}",
    planTitle: "0.2.0 リリースノート", summary: "概要", summaryFirst: "`0.1.9` 以降の主要な 6 変更を、ユーザーが先に気づく順に分類。", summarySecond: "Agent parity を先頭へ——`Kimi` と `OpenCode` が `Codex` と同じ権限段階に到達。",
    plan: "Plan", model: "GPT-5.6 Sol",
    status: "応答中", askAnything: "何でも聞いてください",
  },
  skillsImportTitle: "既存の Agent に {{count}} 個の Skill が見つかりました",
  skillsImportDescription: "取り込むとすべての対応会話で使えます。",
  skillsImportAll: "すべて取り込んで有効化", skillsSkip: "スキップ", skillsUpdateFailed: "Skills の案内状態を更新できませんでした",
};
