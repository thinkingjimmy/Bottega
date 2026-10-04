/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Includes Memory plugin enable, paused/resume and unsupported states; Provides onboardingJa, the Japanese Onboarding catalog
 * [POS]: Japanese leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingJa: typeof onboardingEn = {
  optional: "任意",
  heading: { "chat-home": "{{product}} のファイルはどこに置きますか？", agent: "Agent を設定", extras: "{{product}} をさらに活用" },
  description: {
    "chat-home": "チャット、ファイル、Skills は、あなたが所有する 1 つのフォルダーに保存されます。どちらの場合も、アカウント設定、鍵、端末の権限はこのコンピューターに残ります。",
    agent: "{{product}} はこのコンピューター上のコーディング Agent を通じて動作します。1 つ以上インストールすると次へ進めます。残りはいつでも Settings › Providers から追加できます。",
    extras: "すべて任意です。今スキップしても、後から Settings でオンにできます。",
  },
  back: "戻る", next: "次へ", start: "使い始める",
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
  extras: { skills: "Skills", memory: "Memory プラグイン" },
  skillsAbout: "Agent がすでに持っている Skills を取り込み、すべての会話で使えるようにします。",
  skillsFound: "{{count}} 個見つかりました", skillsImported: "取り込み済み", skillsImport: "すべて取り込む",
  skillsScanning: "既存の Skill を検索中…", skillsNone: "取り込める Skill はまだありません", skillsDone: "個人用 Skills Library の準備ができました",
  skillsScanFailed: "Skills を検索できませんでした。再試行するか、後から Settings で追加できます。",
  skillsImportTitle: "既存の Agent に {{count}} 個の Skill が見つかりました",
  skillsImportDescription: "取り込むとすべての対応会話で使えます。",
  skillsImportAll: "すべて取り込んで有効化", skillsSkip: "スキップ", skillsUpdateFailed: "Skills の案内状態を更新できませんでした",
  memory: {
    badge: { start: "未設定", installing: "インストール中", failed: "未完了", connect: "インストール済み", ready: "準備完了", on: "オン", paused: "一時停止中", unsupported: "非対応" },
    about: "過去の会話から大切なことを覚えておきます。このコンピューター上で小さなサービスを動かします。",
    installing: "{{provider}} をインストール中です。バックグラウンドで続くので、設定は後から完了できます。",
    failed: "{{provider}} のインストールが完了しませんでした。",
    connect: "{{provider}} {{version}} をインストール済み。モデルを接続すると記憶を始めます。",
    ready: "{{provider}} の準備ができました。オンにすると想起と抽出が始まります。",
    on: "Memory プラグインの設定で動作状況や未処理の項目を確認できます。",
    paused: "Memory は一時停止中です。保存済みの記憶は保持されます。", resume: "再開",
    setUp: "設定…", retry: "再試行…", connectAction: "接続…", progress: "進行状況を表示", turnOn: "Memory プラグインを有効にする",
  },
};
