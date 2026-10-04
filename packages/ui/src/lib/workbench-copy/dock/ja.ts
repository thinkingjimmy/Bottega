/**
 * [INPUT]: No runtime dependencies; translated Dock plugin copy.
 * [OUTPUT]: Provides dock catalog strings for ja.
 * [POS]: Nested workbench plugin catalog, consumed by Dock cards, settings and health.
 */
export const dock = {
  "name": "Bottega Dock",
  "summary": "macOS Dock と共存する App ショートカットと使用量ウィジェット。初期状態はオフ。",
  "description": "Bottega Dock は macOS Dock の横に置かれ、App のショートカットと使用量ウィジェットを表示します。\n\n初期状態はオフです。設定で見た目と表示のタイミングを選べます。",
  "running": "Dock は実行中",
  "off": "オフ",
  "loading": "Dock を確認中…",
  "unsupported": "このコンピューターでは利用できません",
  "recoveryPending": "復元が完了していません。Dock の設定で復元を再試行してください。",
  "coexist": "システム Dock と共存",
  "replace": "システム Dock を置換",
  "replacementPending": "0.2.0 では未提供。安全性の検証待ち",
  "autohide": "自動的に隠す",
  "pinned": "常に表示",
  "settings": {
    "showHandle": "ハンドルを表示",
    "privacyMask": "機密の値を隠す",
    "showRunning": "実行中の App を表示",
    "scale": "サイズ",
    "visibility": "表示方法"
  },
  "labels": {
    "mode": "モード",
    "phase": "実行状態",
    "registration": "復元エージェント",
    "accessibility": "アクセシビリティ",
    "automation": "Finder オートメーション",
    "recovery": "前回の復元",
    "sync": "レイアウト同期",
    "replacement": "置換モード"
  },
  "phase": {
    "inactive": "停止中",
    "preparing": "準備中",
    "active": "実行中",
    "restoring": "復元中",
    "suspended": "一時停止中"
  },
  "registration": {
    "notRegistered": "未登録",
    "enabled": "登録済み",
    "requiresApproval": "承認待ち",
    "notFound": "復元サービスがありません",
    "unsupported": "このビルドでは未提供",
    "unknown": "登録状態を確認できません"
  },
  "permission": {
    "granted": "許可済み",
    "notGranted": "未許可",
    "unsupported": "未確認",
    "unknown": "未確認",
    "needsPrompt": "使用時に確認",
    "denied": "拒否済み",
    "unavailable": "利用不可"
  },
  "recovery": {
    "none": "復元記録なし",
    "restored": "復元済み",
    "keptExternal": "システムでの変更を維持",
    "failed": "復元完了を確認できません"
  },
  "sync": {
    "localOnly": "このコンピューターのみ",
    "synced": "同期済み。Dock がオフでも同期は継続",
    "pending": "同期待ちの変更あり",
    "offline": "オフライン。レイアウトは本機に保存",
    "conflict": "レイアウトの変更を確認してください",
    "blocked": "同期を利用できません",
    "error": "同期失敗。レイアウトは保持"
  },
  "unsupportedReason": {
    "platform": "macOS 15 以降が必要",
    "architecture": "Apple シリコンが必要",
    "osVersion": "macOS 15 以降が必要",
    "helperMissing": "Dock ヘルパーがありません。Bottega を再インストールしてください。"
  },
  "effects": {
    "restore": "停止完了前にシステム Dock を復元します。",
    "unregister": "復元の確認後に復元エージェントの登録を解除します。",
    "hide": "Dock バー、メニューとウィジェットを非表示にします。レイアウトは保持し、可能な場合は同期を継続します。"
  },
  "capabilities": {
    "launch": "この Mac の App とシステム項目を開く",
    "usage": "既存のローカル使用量と上限を読み取る",
    "sync": "Dock がオフでもレイアウト同期を継続",
    "permissions": "アクセシビリティと Finder オートメーションの任意の権限は本人が管理"
  }
};
