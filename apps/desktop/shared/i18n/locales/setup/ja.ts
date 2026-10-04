/**
 * [INPUT]: Depends on the setupEn structural type
 * [OUTPUT]: Provides setupJa, the Japanese Setup catalog
 * [POS]: Japanese leaf of shared/i18n/locales/setup; loaded on demand by the matching top-level locale
 */

import type { setupEn } from "./en";

export const setupJa: typeof setupEn = {
  provider: {
    mainWindowOnly: "Agent 環境はメインウィンドウで管理してください。",
  },
  install: "インストール", login: "ログイン",
  checkAgain: "再確認",
  completed: "完了したので再確認",
  state: {
    installed: "インストール済み・試せます",
    previouslyReady: "前回は準備完了",
    checkFailed: "確認未完了",
    waiting: "ターミナルの操作待ち",
    updateRequired: "更新が必要",
    signInRequired: "ログインが必要",
  },
  feedback: {
    load: "Agent の状態を読み込めませんでした",
    check: "確認を完了できませんでした",
    install: "インストールを開けませんでした",
    update: "更新を開けませんでした",
    login: "ログインを開けませんでした",
    clipboard: "コマンドをコピーしました",
    clipboardFailed: "コマンドをコピーできませんでした",
    pasteCommand: "ターミナルに貼り付けて実行し、完了後に再確認してください。",
    retryHint: "再試行してください。以前の Agent の状態は保持されています。",
  },
  guide: {
    claude: { install: "先に Claude Code をインストールしてください。", login: "ターミナルで `claude auth login` を実行してください。" },
    codex: { install: "先に Codex CLI をインストールしてください。", login: "ターミナルで `codex login` を実行してください。" },
    kimi: { install: "先に Kimi Code をインストールしてください。", login: "ターミナルで `kimi login` を実行してください。" },
    opencode: { install: "先に OpenCode をインストールしてください。", login: "ターミナルで `opencode auth login` を実行してください。" },
  },
};
