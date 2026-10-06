/**
 * [INPUT]: Depends on memoryEn from ./en for both its structural type and the English leaves this catalog reuses
 * [OUTPUT]: Includes Memory access selection, explicit workflow-read consent, plugin chrome and native-memory distinction; Provides memoryJa, the Japanese Memory catalog
 * [POS]: Japanese leaf of shared/i18n/locales/memory; loaded on demand by the matching top-level locale
 */

import { memoryEn } from "./en";

export const memoryJa: typeof memoryEn = {
  ...memoryEn,
  plugin: { serviceDisabled: "このサービスを使うには Memory プラグインをオンにしてください。プラグインがオフの間もサービスの設定は保持されます。", open: "Memory プラグインを開く", name: "Memory", official: "公式 · 内蔵", about: "Memory について", unsupported: "このプラットフォームでは Memory を利用できません。現在は macOS のみに対応しています。", nativeDistinction: "Bottega Memory は Codex や Claude の標準メモリーとは別です。標準メモリーは各プラグインの設定で管理します。" },
  access: {"none": "使用しない", "readOnly": "読み取りのみ", "description": "このロールに関連する記憶を読み取ります。ワークフローのロールは Memory に書き込みません。", "workflowOff": "Memory プラグインでワークフローの読み取りが許可されていません。", "workflowOn": "このコンピューターではワークフローの読み取りが許可されています。"},
  workflow: {"sectionTitle": "アクセスと操作", "label": "ワークフローのロールに Memory の読み取りを許可", "description": "設定で「読み取りのみ」を選んだロールだけが記憶を呼び出せます。ワークフローのロールは書き込みません。", "consentTitle": "ワークフローの読み取りを許可しますか？", "consentBody": "設定済みの計画・開発・レビューロールが、タスク名と受け入れ条件を使い、現在の Chat または Project の範囲で記憶を呼び出せます。書き込みは行いません。Memory の一時停止または許可の解除は、次のステップから反映されます。", "confirm": "読み取りのみ許可", "requiresActive": "先に Memory を有効にして同意を完了してください。一時停止中の場合は再開してください。", "personal": "個人の記憶プールではワークフローの読み取りは使えません。Chat または Project の範囲を選んでください。", "saveFailed": "読み取り許可を保存できませんでした。再試行してください。"},
  store: {
    providerListFailed: "Memory プロバイダー一覧を読み込めませんでした",
    statusFailed: "Memory の状態を読み込めませんでした",
    healthFailed: "Memory の健全性を確認できませんでした",
    historyPreviewFailed: "Memory 履歴をプレビューできませんでした",
    attentionFailed: "保留中の Memory 項目を処理できませんでした",
    runtimeStatusFailed: "Memory ランタイムの状態を読み込めませんでした",
    configIssueFailed: "Memory の構成問題を解決できませんでした",
    manualConfigPreviewFailed: "手動構成した送信先をプレビューできませんでした",
    runtimeOperationFailed: "Memory ランタイム操作に失敗しました",
    updateCheckFailed: "Memory の更新を確認できませんでした",
    configPreviewFailed: "Memory の送信先をプレビューできませんでした",
    configAuthorityFailed: "Memory の送信先を承認できませんでした",
    manualConfigAuthorityFailed: "手動構成した送信先を承認できませんでした",
    configSubmitFailed: "Memory ランタイム構成を送信できませんでした",
    destructiveAuthorityFailed: "Memory の破壊的操作を承認できませんでした",
    destructiveFailed: "Memory の破壊的操作に失敗しました",
  },
  common: { unread: "未取得", paused: "一時停止", enabled: "有効" },
  time: { none: "まだありません", now: "たった今" },
  page: { ...memoryEn.page, pausedBanner: "長期メモリーは一時停止中です。Chat、Tools、Apps、Skills は通常どおり動作します。" },
  sharing: {
    title: "共有範囲", description: "新しいメモリーをどの Chat から想起できるかを選びます。範囲変更で古いデータが自動再利用されることはありません。", disabledMemory: "先に長期メモリーを有効にしてください。", disabledTarget: "現在のメモリー送信先は利用できません。", previewFailed: "共有範囲のプレビューに失敗しました",
    dialogTitle: "メモリーの共有範囲を変更しますか？", oldScopeRetained: "古い範囲のデータは保持されますが、想起は停止し、自動統合されません。", historyPaused: "一時停止中も範囲は変更できますが、履歴の取り込みには再開が必要です。", confirm: "範囲変更を確認", readingScope: "共有範囲を確認中…",
    mode: { chat: "この Chat のみ", group: "Project / 単独 Chat プール", personal: "個人メモリープール" },
    isolation: { chat: "新しいメモリーは現在の Chat incarnation だけが想起できます。", group: "同じ Project の Chat 同士で想起でき、単独 Chat は別の共通プールを使います。", personal: "すべての Project と単独 Chat が同じ個人プールから想起できます。" },
  },
  runtime: { running: "処理中…", openRunning: "メモリーの実行状況を開く" },
  receipt: { used: "長期メモリー・{{count}} 件を要求とともに送信", usedDetail: "送信はモデルが採用したことを意味しません", none: "長期メモリー・関連内容なし", unavailable: "長期メモリーを利用できず、このターンでは未使用", planMode: "長期メモリー・Plan モードでは未使用", promptNotIssued: "長期メモリー・Agent 要求は送信されませんでした", failure: { initialization: "メモリー状態を初期化できませんでした", "scope-resolution": "このターンのメモリー範囲を解決できませんでした", "policy-store": "メモリーポリシー台帳を利用できません", "runtime-configuration": "メモリーランタイム設定を利用できません", identity: "メモリーサービスの識別確認に失敗しました", provider: "メモリープロバイダーに失敗しました", ownership: "メモリーの所有権確認に失敗しました", deadline: "メモリー想起が期限を超えました", "render-budget": "メモリーコンテキストが表示予算を超えました", "stale-capability": "メモリー権限が失効しました" } },
};
