/**
 * [INPUT]: Depends on no runtime modules
 * [OUTPUT]: Provides localized Agent selection, pending, eligibility, and retained-history disclosure
 * [POS]: Chat Agent switch locale leaf
 */

export const chatAgentSwitchJa = {
  "pending": "次のメッセージには {{backend}} が返信します。履歴は保持されます。",
  "undo": "元に戻す",
  "details": "引き継ぎ情報",
  "explanation": "新しい Agent は履歴の抜粋を受け取り、利用可能な場合は保存済みの記録を読みます。過去の画像やツールの実行状態は引き継ぎません。",
  "permission": "権限：{{from}} → {{to}}",
  "confirming": "送信結果を確認中…",
  "recovering": "メッセージを保存しました。復旧中…",
  "stale": "このチャットが変更されました。Agent を選び直してください。",
  "adjacent": "新しいメッセージを送信するか、Agent の変更を元に戻してください。",
  "defaultsFailed": "チャット設定は保存されましたが、既定値の更新に失敗しました。",
  "divider": "ここからは {{backend}} が返信します",
  "notInjected": "一部の履歴は含まれていません。保存済みの記録は読み取れる場合があります。",
  "storageTrimmed": "古い記録の一部は保存されていません。",
  "lookupUnavailable": "このターンでは履歴を追加で読み取れません。",
  "running": "返信が終了すると変更できます。",
  "queue": "送信待ちメッセージを処理してください。",
  "recovery": "復旧が完了するまでお待ちください。",
  "readonly": "読み取り専用です。まず元の Agent で引き継いでください。",
  "app-bound": "Agent は App によって指定されています。",
  "archived": "アーカイブ済みチャットでは変更できません。",
  "approval": "保留中の承認を処理してください。",
  "plan-review": "Plan の確認を完了してください。",
  "paused": "一時停止中のチェーンを再開または終了してください。",
  "submission": "前回の送信結果を確認してください。",
  "selectionFailed": "Agent を選択できませんでした：{{message}}",
  "revision-stale": "このチャットが変更されました。Agent を選び直してください。"
};
