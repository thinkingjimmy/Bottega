/**
 * [INPUT]: Depends on the English Agent failure catalog shape
 * [OUTPUT]: Provides Japanese Agent failure presentation copy
 * [POS]: Japanese leaf for provider-neutral Agent failures
 */

import { agentFailureEn } from "./en";

export const agentFailureJa: typeof agentFailureEn = {
  technicalDetails: "技術的な詳細",
  copyDetails: "技術的な詳細をコピー",
  copiedDetails: "技術的な詳細をコピーしました",
  code: {
    "app-disabled": {"title": "この App は閉じています", "explanation": "App が閉じている間は使用・編集できません。", "resolution": "App のメニューから再度開いて続けてください。"},
    "mode-unsupported": {"title": "この Agent は選択したモードを使用できません", "explanation": "Provider に互換性のあるモードがありません。", "resolution": "対応するモードまたは別の Agent を選んで再試行してください。"},
    "auth-required": { title: "{{backend}} に再ログインしてください", explanation: "ログインの有効期限が切れたか、ログインが完了していません。", resolution: "ターミナルで `{{command}}` を実行し、ログイン完了後に Bottega へ戻って再試行してください。" },
    "rate-limited": { title: "{{backend}} へのリクエストが多すぎます", explanation: "プロバイダーが一時的に新しいリクエストを制限しています。", resolution: "少し待ってから再試行してください。続く場合はネットワークとプロバイダーの稼働状況を確認してください。" },
    "quota-exhausted": { title: "{{backend}} の利用可能枠がありません", explanation: "アカウントが利用上限に達したか、残高がありません。", resolution: "プラン、使用量、請求を確認するか、表示されたリセット時刻まで待って再試行してください。" },
    "context-exhausted": { title: "この会話は長すぎて続行できません", explanation: "Agent がこの会話のコンテキストまたはセッション上限に達しました。", resolution: "新しい Chat を開始し、文章、ファイル、貼り付け内容を減らしてください。" },
    "connection-lost": { title: "{{backend}} との接続が中断されました", explanation: "Bottega は Agent との安定した接続を維持できませんでした。", resolution: "ネットワーク、VPN、プロキシを確認し、接続が安定してから再試行してください。" },
    "request-rejected": { title: "{{backend}} はこのリクエストを処理できません", explanation: "選択したモデル、設定、またはリクエストが受け付けられませんでした。", resolution: "利用可能なモデルを選び、Agent 設定を確認して、より短く単純な内容で再試行してください。" },
    "service-unavailable": { title: "{{backend}} は一時的に利用できません", explanation: "Agent またはモデルプロバイダーで一時的な問題が発生しました。", resolution: "後でもう一度試してください。続く場合は Agent を更新し、技術的な詳細をコピーしてサポートへ共有してください。" },
    "runtime-unavailable": { title: "{{backend}} を起動できません", explanation: "ローカル Agent が未導入、古い、または起動確認に失敗しました。", resolution: "Agent 設定で {{backend}} をインストールまたは更新し、再確認してください。" },
    "startup-recovery-pending": { title: "Bottega は起動時のチェックをまだ実行中です", explanation: "Bottega は起動時のチェックをまだ完了していません。", resolution: "しばらくしてからもう一度お試しください。" },
    "earlier-process-holding": { title: "以前の Agent プロセスがまだ終了処理中です", explanation: "以前の Agent プロセスがまだ終了処理中です。", resolution: "終了してからもう一度お試しください。" },
    unknown: { title: "{{backend}} はリクエストを完了できませんでした", explanation: "Bottega が安全に分類できない問題を Agent が報告しました。", resolution: "もう一度試してください。続く場合は技術的な詳細を開いてコピーし、サポートへ共有してください。" },
  },
  apiKey: { title: "{{backend}} の API キーが拒否されました", explanation: "{{backend}} が使用している API キーまたはゲートウェイのトークンが無効か、期限切れです。", resolution: "キーを設定した場所（Claude Code の設定またはゲートウェイ）で更新してから、もう一度お試しください。" },
  /* Startup recovery holding: a queued turn waits and sends itself. */
  recovery: {
    queued: { "startup-recovery-pending": "Bottega は起動時のチェックをまだ実行中です。完了するとメッセージが送信されます。", "earlier-process-holding": "以前の Agent プロセスがまだ終了処理中です。終了するとメッセージが送信されます。" },
  },
  notice: {
    title: "{{backend}} からのお知らせがあります",
    explanation: "このお知らせは {{backend}} 自身からのもので、Bottega の問題ではありません。この返信には影響しません。",
  },
};
