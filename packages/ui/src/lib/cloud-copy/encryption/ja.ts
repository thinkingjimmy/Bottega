/**
 * [INPUT]: The shared encrypted-sync copy contract.
 * [OUTPUT]: Japanese setup, creation requirement checklist, immediate password validation, unlock and recovery messages.
 * [POS]: Shared desktop and Web encryption presentation.
 */
import type { CloudEncryptionCopy } from "./en";
export const ja: CloudEncryptionCopy = {
  setupInProgress: "同期を有効にしています…", setupConnectionFailed: "接続に失敗しました。ネットワークを確認して、もう一度お試しください。",
  title: "同期ワークスペースをロック解除", description: "デスクトップで設定した同期パスワードを入力してください。", password: "同期パスワード", confirmation: "同期パスワードを確認",
  setPassword: "同期パスワードを設定", setupDescription: "自分だけが知っているパスワードを設定し、安全に保管してください。Bottega は復元できません。",
  risk: "パスワードを失うと、クラウドのデータを復元できない場合があることを理解しました。", inProgress: "同期を保護しています…",
  unlock: "ロック解除", unlocking: "ロック解除中…", checking: "暗号化同期を確認中…", remember: "このブラウザのロック解除を保持",
  rememberDescription: "暗号化した解除キーをこのブラウザに保存します。いつでもロックできます。", remembered: "このブラウザは解除キーを記憶します。", thisPageOnly: "このページのみロック解除されています。",
  saving: "解除キーを保存中…", saveFailed: "現在は解除されていますが、解除キーを保存できませんでした。次回は同期パスワードが必要になる場合があります。", saveRetry: "解除キーの保存を再試行",
  cachedStorageUnavailable: "安全なローカルストレージを利用できません。アプリを開き直す際に同期パスワードが必要になる場合があります。", cacheUnreadable: "保存された解除キーを読み取れません。同期パスワードを入力してください。",
  cacheClearFailed: "保存された解除キーを削除できませんでした。再試行してブラウザの記憶済みアクセスを解除してください。", lock: "このブラウザをロック", locked: "同期ワークスペースはロックされています",
  offlineTitle: "接続してワークスペースをロック解除", offlineDescription: "保存された内容を解除する前にアカウントの確認が必要です。暗号化キャッシュは保持されます。",
  unavailable: "暗号化同期を確認できませんでした。再試行してください。",
  reviewExpired: "確認の有効期限が切れました。再スキャンしてください。", connectionFailed: "接続できません。オンラインに戻ると暗号化同期を続行します。", retry: "再試行", cancel: "キャンセル", account: "アカウントと端末",
  showPassword: "パスワードを表示", hidePassword: "パスワードを隠す", passwordMismatch: "パスワードが一致しません。", independentPassword: "Google のパスワードとは別で、同期内容のロック解除にのみ使います。",
  unrecoverableCloud: "同期パスワードを安全に保管してください。Google アカウントを復旧しても、このパスワードは復元できません。紛失して古いデータを復号できる端末がなくなると、クラウドのみにある内容は復元できません。",
  secureSaveFailedDesktop: "このコンピュータに解除キーを安全に保存できませんでした。同期は無効のままです。保存を再試行してから有効にしてください。",
  legacyUnsupported: "このアカウントには以前の同期形式のデータが残っています。処理が完了するまで暗号化同期は開始できません。",
  passwordTooShort: "8 文字以上のパスワードを入力してください。",
  passwordTooLong: "UTF-8 で 1,024 バイト以下にしてください。文字によって複数バイトを使用します。",
  passwordRules: "パスワードの条件", ruleMet: "満たしています", ruleUnmet: "未達成",
  ruleLength: "12 文字以上", ruleLetter: "文字を 1 つ以上含める", ruleDigit: "数字を 1 つ以上含める",
  ruleSimple: "同じ文字や連続した文字の繰り返しを避ける", ruleEmail: "メールアドレスのユーザー名を含めない", ruleCommon: "よく使われるパスワードや「Bottega」を避ける",
  "sync-password-invalid": "8 文字以上、UTF-8 で 1,024 バイト以下にしてください。文字によって複数バイトを使用します。",
  "sync-password-weak": "より強いパスワードにして、すべての条件を満たしてください。",
  "sync-unlock-failed": "この同期パスワードで解除できませんでした。確認して再試行してください。", "sync-integrity-failed": "暗号化された内容を検証できません。最新の内容を読み直してください。",
  "sync-encryption-unsupported": "必要な暗号化機能を利用できません。最新版の Chrome または Bottega デスクトップを使用してください。",
  "sync-space-changed": "暗号化ワークスペースまたはキーが変更されたため、アクセスを停止しました。アカウントと復元情報を確認してください。",
  "sync-operation-cancelled": "ロック解除をキャンセルしました。", "sync-operation-busy": "別の暗号化処理が実行中です。完了を待つかキャンセルしてください。", "sync-locked": "同期ワークスペースをロック解除してください。",
  checkingDescription: "このアカウントの暗号化スペースを確認しています。",
  unavailableTitle: "暗号化同期を確認できませんでした", unavailableDescription: "再試行してもう一度確認してください。ログイン情報は保持されています。",
  unsupportedTitle: "このブラウザーでは暗号化同期を実行できません", lockFailedTitle: "ロックが完了しませんでした",
  cancelledDescription: "ロック解除をキャンセルしました。同期パスワードを入力してもう一度お試しください。",
  lockedDescription: "このブラウザはロックされています。続けるには同期パスワードを入力してください。",
  missingUnlock: "このブラウザに保存された解除情報がありません。同期パスワードを再入力してください。",
};
