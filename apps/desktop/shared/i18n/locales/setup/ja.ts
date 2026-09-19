/**
 * [INPUT]: Depends on the setupEn structural type
 * [OUTPUT]: Provides setupJa, the Japanese Setup catalog
 * [POS]: Japanese leaf of shared/i18n/locales/setup; loaded on demand by the matching top-level locale
 */

import type { setupEn } from "./en";

export const setupJa: typeof setupEn = {
  configure: "設定",
  provider: {
    mainWindowOnly: "Agent 環境はメインウィンドウで管理してください。",
  },
  install: "インストール", login: "ログイン", manageLogin: "ログインを管理", update: "更新できます",
  updateAria: "{{backend}} を更新", recheck: "{{backend}} を再検出",
  checkAgain: "再確認",
  updateNow: "更新",
  reinstall: "再インストール",
  more: "{{backend}} のその他の操作",
  completed: "完了したので再確認",
  checkedAt: "前回の確認：{{time}}",
  state: {
    installed: "インストール済み・試せます",
    previouslyReady: "前回は準備完了",
    checkFailed: "確認未完了",
    waiting: "ターミナルの操作待ち",
    updateRequired: "更新が必要",
    signInRequired: "ログインが必要",
  },
  verification: {
    unverified: "ログイン状態は最初の会話で確認されます。",
    expired: "前回成功した確認結果を表示しています。",
    failed: "確認を完了できませんでした。前回の結果を保持しています。再確認してください。",
    updateRequired: "現在のバージョンは {{version}} です。{{minimum}} 以降が必要です。",
    signInRequired: "ログインすると、この Agent を利用できます。",
    cannotCheck: "インストール状態を確認できませんでした。再確認してください。",
    cannotStart: "Agent を起動できませんでした。再確認するか、その他のメニューから再インストールしてください。",
    waiting: "ターミナルの操作を終えてこのウィンドウに戻ると、自動で再確認します。",
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
  checkIssue: {
    timeout: "確認がタイムアウトしました。しばらくしてから再確認してください。",
    connection: "サービスに接続できませんでした。ネットワークを確認して再試行してください。",
    busy: "Agent は使用中です。現在の操作が終わってから再確認してください。",
    failed: "確認を完了できませんでした。以下の詳細を確認して再試行してください。",
  },
  guide: {
    claude: { install: "先に Claude Code をインストールしてください。", login: "ターミナルで `claude auth login` を実行してください。" },
    codex: { install: "先に Codex CLI をインストールしてください。", login: "ターミナルで `codex login` を実行してください。" },
    kimi: { install: "先に Kimi Code をインストールしてください。", login: "ターミナルで `kimi login` を実行してください。" },
    opencode: { install: "先に OpenCode をインストールしてください。", login: "ターミナルで `opencode auth login` を実行してください。" },
  },
};
