/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingJa, the Japanese Onboarding catalog
 * [POS]: Japanese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingJa: typeof onboardingEn = {
  rail: {
    steps: "セットアップの手順",
    intro: "3 つの簡単なステップです。ここでの設定はすべて後から Settings で変更できます。",
    footer: "{{product}} はローカルで動作します。指示しない限り、何もこのコンピューターの外に出ません。",
    done: "完了",
  },
  step: {
    "chat-home": { label: "データの保存先", hint: "チャットとファイルの置き場所" },
    agent: { label: "Agent", hint: "チャットを始めるには 1 つ以上必要" },
    extras: { label: "その他", hint: "Skills とメモリー（任意）" },
  },
  heading: { "chat-home": "{{product}} のファイルはどこに置きますか？", agent: "Agent を設定", extras: "{{product}} をさらに活用" },
  description: {
    "chat-home": "空のフォルダーを選んで新しく始めるか、既存の {{product}} フォルダーを選んで続きから再開します。どちらの場合も、アカウント設定、鍵、端末の権限はこのコンピューターに残ります。",
    agent: "{{product}} はこのコンピューター上のコーディング Agent を通じて動作します。1 つ以上インストールすると次へ進めます。残りはいつでも Settings › Providers から追加できます。",
    extras: "すべて任意です。今スキップしても、後から Settings でオンにできます。",
  },
  back: "戻る", next: "次へ", start: "使い始める",
  folder: "{{product}} フォルダー",
  chatHome: { unconfigured: "未選択", ready: "準備完了" },
  chatHomeUnset: "このコンピューターのフォルダーを選んでください。", choose: "選択…", opening: "開いています…",
  folderProgress: { opening: "ファイルを開いています… {{completed}} / {{total}}", saving: "ファイルを保存しています… {{completed}} / {{total}}" },
  agentLater: "後でインストール",
  agentLaterFailed: "この選択を保存できませんでした。もう一度お試しください。",
  agentInstalled: "インストール済み",
  agentChecking: "確認中…",
  agentInstalling: "インストール待ち…",
  agentCheckFailed: "インストールを確認できませんでした。再試行してください。",
  agentAbout: { codex: "OpenAI のコーディング Agent", claude: "Anthropic のコーディング Agent", kimi: "Moonshot のコーディング Agent", opencode: "オープンソース、好きなモデルを利用可能" },
  extras: { skills: "Skills", memory: "長期メモリー" },
  skillsAbout: "Agent がすでに持っている Skills を取り込み、すべての会話で使えるようにします。",
  skillsFound: "{{count}} 個見つかりました", skillsImported: "取り込み済み", skillsImport: "すべて取り込む",
  skillsScanning: "既存の Skill を検索中…", skillsNone: "取り込める Skill はまだありません", skillsDone: "個人用 Skills Library の準備ができました",
  skillsScanFailed: "Skills を検索できませんでした。再試行するか、後から Settings で追加できます。",
  skillsImportTitle: "既存の Agent に {{count}} 個の Skill が見つかりました",
  skillsImportDescription: "取り込むとすべての対応会話で使えます。",
  skillsImportAll: "すべて取り込んで有効化", skillsSkip: "スキップ", skillsUpdateFailed: "Skills の案内状態を更新できませんでした",
  memory: {
    badge: { start: "未設定", installing: "インストール中", failed: "未完了", connect: "インストール済み", ready: "準備完了", on: "オン" },
    about: "過去の会話から大切なことを覚えておきます。このコンピューター上で小さなサービスを動かします。",
    installing: "{{provider}} をインストール中です。バックグラウンドで続くので、設定は後から完了できます。",
    failed: "{{provider}} のインストールが完了しませんでした。",
    connect: "{{provider}} {{version}} をインストール済み。モデルを接続すると記憶を始めます。",
    ready: "{{provider}} の準備ができました。オンにすると想起と抽出が始まります。",
    on: "Settings › Memory で稼働状況と欠落を確認できます。",
    setUp: "設定…", retry: "再試行…", connectAction: "接続…", progress: "進行状況を表示", turnOn: "オンにする",
  },
};
