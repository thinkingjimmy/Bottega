/**
 * [INPUT]: Depends on the English Chat runtime catalog shape
 * [OUTPUT]: Provides the Japanese Chat runtime catalog
 * [POS]: Japanese projection for attachment, queue, submission, settings, and recovery messages
 */

import type { chatRuntimeEn } from "./en";

export const chatRuntimeJa: typeof chatRuntimeEn = {
  attachment: {
    takeoverFailed: "**実行状態の引き継ぎに失敗しました：** {{message}}",
    chatLoadFailed: "**チャットの読み込みに失敗しました：** {{message}}",
  },
  queue: {
    notPersisted: "メッセージを保存できませんでした。修正して再試行してください。",
    recoverable: "メッセージは復元できます。再送すると新しい送信 ID が作成されます。",
    retryAgentTurn: "ユーザーメッセージは保存済みです。「Agent turn を再試行」を使用してください。",
    reconciling: "送信を照合中です。通常の再試行では二重実行になる可能性があります。",
    failedResourcesReleased: "送信に失敗し、main は再試行用リソースを解放しました。編集して再送してください。",
    failed: "送信に失敗しました。",
    steerReturned: "steering が完了しなかったため、メッセージをキューに戻しました。",
    staleResourcesDecision: "再起動前のリソースが含まれています。正確に再送するか削除してください。",
    staleWorkspaceWait: "再起動前の Workspace リソースが含まれています。確定結果を待つか削除してください。",
    steerPrepareFailed: "挿入メッセージを準備できませんでした：{{message}}",
    steerVerifyFailed: "メッセージが挿入されたか確認できませんでした：{{message}}",
    steerHistoryPending: "メッセージは挿入されました。履歴を保存しています。",
    steerQueuedNext: "現在の turn で消費されなかったため、次のメッセージとしてキューに追加しました。",
    steerDeliveryUnknown: "配信を確認できませんでした。会話を確認してから再送または削除してください。",
    turnEnded: "現在の turn は終了したため、通常のキューから送信します。",
    viewChangedSteerCancelled: "Chat 表示が切り替わったため、以前の表示の Steer メッセージは送信しませんでした。",
    workspaceChangedNoResend: "Workspace が変更されました。新しい Workspace では再送できないため、削除して入力し直してください。",
    durableOutcomeUnavailable: "durable outcome を取得できません。照合状態を維持します。",
    mainCustodyPending: "送信はまだ main が保持しています。確定結果を待ってください。",
    noSafeNegativeProof: "main から未到達の安全な証明がないため、無条件には再送できません。",
    ordinaryResendUnavailable: "この送信は通常の方法では再送できません。durable outcome の案内に従ってください。",
  },
  submission: {
    notSent: "**メッセージを送信できませんでした：** {{message}}",
    stateUnknown: "**メッセージの状態が不明です：** {{message}}。元の送信 ID は保持されています。キューで再送または削除を選択してください。",
    relayPaused: "メッセージをキューに追加しました。この Section のリレーチェーンは一時停止中です。チャット上部の「続行」を先に処理してください。",
    relayPending: "メッセージをキューに追加しました。この Section には処理待ちのリレーメッセージがあります。",
    acceptedRefreshFailed: "Agent はメッセージを受理しましたが、ローカルセッションを更新できませんでした：{{message}}。再送しないでください。タスクは続行します。",
    backendSetupRequired: "**先に {{backend}} のセットアップを完了してください。** インストールとサインインの案内を開きました。",
    localPreparationFailed: "ローカルセッションの準備に失敗しました：{{message}}",
  },
  settings: {
    readFailed: "Agent 設定の読み込みに失敗しました：{{message}}",
    saveFailed: "Agent 設定の保存に失敗しました：{{message}}",
    transcriptReadFailed: "**Agent 設定の読み込みに失敗しました：** {{message}}",
  },
  relayStopFailed: "Section リレーチェーン全体を停止できなかったため、現在のリクエストを停止しました：{{message}}。再試行できます。",
  actionFailed: "**{{action}}に失敗しました：** {{message}}",
  abandonTurn: "turn を破棄",
  acknowledgeCleanup: "クリーンアップを確認",
  unnamed: "無題",
};
