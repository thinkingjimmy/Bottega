/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingJa, the Japanese Onboarding catalog
 * [POS]: Japanese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingJa: typeof onboardingEn = {
  agentLater: "後でインストール",
  agentLaterFailed: "この選択を保存できませんでした。もう一度お試しください。",
  folderProgress: {"opening": "ファイルを開いています… {{completed}} / {{total}}", "saving": "ファイルを保存しています… {{completed}} / {{total}}"} ,
  agentInstalled: "インストール済み",
  agentChecking: "確認中…",
  agentInstalling: "インストール待ち…",
  agentCheckFailed: "インストールを確認できませんでした。再試行してください。",
  step: { "chat-home": "データの保存先", agent: "Agent", extras: "その他の機能" },
  heading: { "chat-home": "{{product}} のファイルはどこに置きますか？", agent: "Agent を設定", extras: "{{product}} をさらに活用" },
  back: "戻る", next: "次へ", start: "使い始める",
  description: { "chat-home": "既存の Bottega フォルダーから内容を復元するか、空のフォルダーで始められます。アカウント設定、鍵、端末の権限はこのコンピューターに残ります。", agent: "Agent を 1 つ以上インストールすると次へ進めます。", extras: "再利用できる Skills を取り込み、長期メモリーを設定できます。どちらも任意で、後から Settings で変更できます。" },
  extras: { skills: "Skills", memory: "長期メモリー" },
  skillsScanFailed: "Skills を検索できませんでした。再試行するか、後から Settings で追加できます。",
  skillsImportTitle: "既存の Agent に {{count}} 個の Skill が見つかりました",
  skillsImportDescription: "取り込むとすべての対応会話で使えます。",
  skillsScanning: "既存の Skill を検索中…", skillsFound: "既存の Agent に {{count}} 個の Skill が見つかりました · 取り込むとすべての対応会話で使えます", skillsNone: "取り込める Skill はまだありません", skillsDone: "個人用 Skills Library の準備ができました", skillsImportAll: "すべて取り込んで有効化", skillsSkip: "スキップ", skillsUpdateFailed: "Skills の案内状態を更新できませんでした",
  chatHome: { unconfigured: "このコンピューターのフォルダーを選んでください。", ready: "Bottega フォルダーの準備ができました。" },
  chatHomeUnset: "未選択", choose: "フォルダーを選択…", opening: "開いています…",
  memoryEnabled: "Settings › Memory で稼働状況と欠落を確認できます。", memoryDisabled: "ローカルのメモリーサービスを導入し、プライバシー開示を一度確認すると、想起と抽出が始まります。",
  memoryAction: "メモリーを設定",
  memoryInstalling: "{{provider}} をインストール中…バックグラウンドで続きます。今すぐ使い始められます。", memoryInstallFailed: "{{provider}} のインストールが完了しませんでした。",
  memoryConnect: "{{provider}} {{version}} をインストール済み。モデルを接続すると完了です。", memoryReady: "{{provider}} の準備ができました。オンにすると想起と抽出が始まります。",
  memoryProgress: "進行状況を表示", memoryTurnOn: "オンにする", memoryHide: "閉じる",
};
