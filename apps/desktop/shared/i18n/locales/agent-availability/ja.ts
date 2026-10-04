/**
 * [INPUT]: Depends on the shared availability state vocabulary.
 * [OUTPUT]: Provides localized Agent availability and recovery copy.
 * [POS]: Availability locale leaf.
 */
export const agentAvailabilityJa = {
  "state": {
    "recent-sign-in": "直近のリクエストでログインが必要",
    "connection": "接続の問題",
    "service": "サービスの問題",

    "ready": "準備完了",
    "custom-route": "カスタムエンドポイント · ログイン未確認",
    "unverified": "未確認",
    "checking": "確認中",
    "missing": "未インストール",
    "unsupported": "更新があります",
    "sign-in": "未ログイン",
    "cannot-check": "確認できません",
    "cannot-start": "起動できません",
    "usage-limit": "利用上限",
    "unavailable": "利用できません"
  },
  "unavailableReason": {
    "package-disabled": "プラグインでオフになっています",
    "package-removed": "このコンピューターから削除されました",
    "package-refused": "読み込めませんでした",
    "trust-refused": "このコンピューターでは信頼されていません"
  },
  "imagesPreserved": "この Agent はこれらの画像を送信できません。添付は保持されます。",
  "managementUnavailable": "Agent を管理するにはメインウィンドウを開いてください。",
  "openMenu": "Agent メニューを開く",
  "manage": "Agent を管理",
  "login": "ログイン",
  "retry": "再試行",
  "locked": "このチャットでは Agent を変更できません。",
  "blocked": "{{backend}} は利用できません。下書きは保持されています。",
  "retrySending": "送信を再試行",
  "retryExplanation": "ログイン済み、または確認結果が誤っている場合は、このメッセージの送信を試せます。",
  "customRoute": "{{backend}} は設定されたエンドポイントにリクエストを送信します。Bottega はそこでのログインが有効か確認できません。リクエストが失敗した場合は、その理由が表示されます。",
  "isolatedConfig": "Bottega は独自の設定で {{backend}} を実行します。~/.config/opencode やプロジェクトの opencode.json で設定したプロバイダーは、ここでは使われません。",
  "unverifiedReason": {
    "provider-scoped": "{{backend}} はプロジェクトごとにログインを確認するため、Chat の実行時に確認されます。",
    "not-supported": "{{backend}} はログイン状態を Bottega に報告できません。ログインが必要な場合は Chat でお知らせします。"
  }
};
