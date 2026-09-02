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
    "auth-required": { title: "{{backend}} に再ログインしてください", explanation: "ログインの有効期限が切れたか、ログインが完了していません。", resolution: "ターミナルで `{{command}}` を実行し、ログイン完了後に Bottega へ戻って再試行してください。" },
    "rate-limited": { title: "{{backend}} へのリクエストが多すぎます", explanation: "プロバイダーが一時的に新しいリクエストを制限しています。", resolution: "少し待ってから再試行してください。続く場合はネットワークとプロバイダーの稼働状況を確認してください。" },
    "quota-exhausted": { title: "{{backend}} の利用可能枠がありません", explanation: "アカウントが利用上限に達したか、残高がありません。", resolution: "プラン、使用量、請求を確認するか、表示されたリセット時刻まで待って再試行してください。" },
    "context-exhausted": { title: "この会話は長すぎて続行できません", explanation: "Agent がこの会話のコンテキストまたはセッション上限に達しました。", resolution: "新しい Chat を開始し、文章、ファイル、貼り付け内容を減らしてください。" },
    "connection-lost": { title: "{{backend}} との接続が中断されました", explanation: "Bottega は Agent との安定した接続を維持できませんでした。", resolution: "ネットワーク、VPN、プロキシを確認し、接続が安定してから再試行してください。" },
    "request-rejected": { title: "{{backend}} はこのリクエストを処理できません", explanation: "選択したモデル、設定、またはリクエストが受け付けられませんでした。", resolution: "利用可能なモデルを選び、Agent 設定を確認して、より短く単純な内容で再試行してください。" },
    "service-unavailable": { title: "{{backend}} は一時的に利用できません", explanation: "Agent またはモデルプロバイダーで一時的な問題が発生しました。", resolution: "後でもう一度試してください。続く場合は Agent を更新し、技術的な詳細をコピーしてサポートへ共有してください。" },
    "runtime-unavailable": { title: "{{backend}} を起動できません", explanation: "ローカル Agent が未導入、古い、または起動確認に失敗しました。", resolution: "Agent 設定で {{backend}} をインストールまたは更新し、再確認してください。" },
    unknown: { title: "{{backend}} はリクエストを完了できませんでした", explanation: "Bottega が安全に分類できない問題を Agent が報告しました。", resolution: "もう一度試してください。続く場合は技術的な詳細を開いてコピーし、サポートへ共有してください。" },
  },
};
