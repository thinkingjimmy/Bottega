/**
 * [INPUT]: The shared protection copy contract.
 * [OUTPUT]: Japanese offline reading, the per-device offline switch and phone offer, background mask, secure-storage recovery and biometric setting messages.
 * [POS]: Shared Cloud Web / mobile shell presentation.
 */
import type { CloudProtectionCopy } from "./en";
export const ja: CloudProtectionCopy = {
  offlineBanner: "オフライン · 最終同期 {{time}}", offlineBannerUnknown: "オフライン · 保存済みの内容を表示中",
  offlineReadOnly: "閲覧のみです。送信・編集・ダウンロードは再接続後に使えます。", reconnecting: "再接続しています…",
  savedChats: "保存済みのチャット", allChats: "すべてのチャット",
  offlineEmpty: "このデバイスにはまだチャットが保存されていません。接続するとワークスペースを読み込めます。",
  offlineChatMissing: "このチャットはオフライン用に保存されていません。",
  offlineEarlier: "それより前のメッセージはオンライン時に表示できます。",
  offlineDecryptFailed: "保存済みの内容を復号できませんでした。接続して再読み込みしてください。",
  offlineUnavailableTitle: "接続してワークスペースを開いてください",
  offlineExpired: "このデバイスが最後に接続してから時間が経ちすぎています。インターネットに接続して読み続けてください。",
  offlineNoSnapshot: "このデバイスではオフライン閲覧がオンになっていません。オンライン時に設定からオンにしてください。",
  offlineClock: "このデバイスの時計が過去に戻されました。インターネットに接続してアクセスを確認してください。",
  offlineOpening: "保存済みの内容を開いています…", retry: "再試行",
  maskTitle: "Bottega はロックされています", maskDescription: "本人確認をするとワークスペースを表示します。", maskResume: "ロック解除", maskVerifying: "確認しています…",
  maskCancelled: "確認がキャンセルされました。もう一度試すか、同期パスワードを使ってください。", usePassword: "同期パスワードを使う",
  capabilityMissing: "このデバイスのセキュアストレージを現在利用できないため、保存済みのロック解除キーを開けません。アプリを再起動または更新するか、同期パスワードを入力してください。",
  biometricChanged: "指紋または顔の登録が変更されたため、保存済みのロック解除キーを開けなくなりました。同期パスワードを一度入力してください。",
  biometricLabel: "指紋または顔認証を必須にする",
  biometricDescription: "Bottega に戻るたびに指紋または顔で確認します。登録した指紋や顔が変わった場合は、同期パスワードを一度入力する必要があります。",
  biometricNotEnrolled: "この機能を使うには、端末の設定で指紋または顔認証を登録してください。",
  biometricNeedsKeepUnlocked: "先に同期パスワードでロックを解除し、「ロック解除を保持」をオンにしてください。",
  biometricFailed: "設定を保存できませんでした。もう一度お試しください。",
  offlinePhoneLabel: "このスマートフォンでチャットをオフラインでも使えるようにする",
  offlineBrowserLabel: "このブラウザをオフライン閲覧用に信頼する",
  offlineDescription: "保存済みのチャットを接続なしで開くために必要なものをこのデバイスに保存します。最後の接続から最大 30 日間オフラインで開け、その後は再接続が必要です。このデバイスに保存済みのチャットは、この設定をオフにするか、このデバイスをロックするか、サインアウトするまで残ります。",
  offlineBrowserWarning: "信頼できるブラウザでのみオンにしてください。このブラウザプロファイルを使える人は誰でも、保存済みのチャットをオフラインで開けます。",
  offlineChangeFailed: "オフライン閲覧の設定を変更できませんでした。もう一度お試しください。",
  offlineOfferTitle: "このスマートフォンでチャットをオフラインでも使えるようにしますか？",
  offlineOfferBody: "このスマートフォンが最後に接続してから最大 30 日間、保存済みのチャットを接続なしで開けます。設定からいつでもオフにでき、オフにするとオフライン用のコピーは削除されます。",
  offlineOfferAccept: "オフラインで保持",
  offlineOfferDecline: "今はしない",
};
