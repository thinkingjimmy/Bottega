/**
 * [INPUT]: Depends on the chatEn structural type
 * [OUTPUT]: Provides chatJa, the Japanese Chat catalog
 * [POS]: Japanese leaf of shared/i18n/locales/chat; loaded on demand by the matching top-level locale
 */

import type { chatEn } from "./en";

export const chatJa: typeof chatEn = {
  provider: {
    listFailed: "Chat 一覧の読み込みに失敗しました：{{message}}",
    renameFailed: "Chat の名前変更に失敗しました：{{message}}",
    sortFailed: "Chat の移動に失敗しました：{{message}}",
    archiveFailed: "Chat のアーカイブに失敗しました：{{message}}",
    deleteFailed: "Chat の削除に失敗しました：{{message}}",
  },
  sidebar: {
    priority: "優先",
    nothingNeedsAttention: "対応が必要な項目はありません",
    waiting: "返信を待っています",
    running: "生成中",
    done: "新しい返信があります",
    failed: "実行に失敗しました",
    archiveChat: "チャットをアーカイブ",
    moreActions: "その他の操作",
    archive: "アーカイブ",
    reorder: {
      pickedUp: "{{title}} を持ち上げました",
      moved: "{{title}} を {{count}} 件中 {{position}} 番目に移動しました",
      unchanged: "{{title}} の位置は変わりません",
      cancelled: "並べ替えをキャンセルしました",
    },
  },
  workspaceFiles: {
    bridgeUnavailable: "この環境では Workspace ファイルを利用できません。",
    searchFailed: "Workspace ファイルの検索に失敗しました。",
  },
  interrupted: "応答が中断されました。途中の結果は保存されています。",
  noText: "このターンはテキストを返しませんでした。",
  relayStopConfirm: "現在のリクエストを停止し、Section リレーチェーン全体を切断しますか？",
  workspaceImage: {
    unsupported: "選択したパスは対応している画像ではありません。",
    admissionFailed: "画像を添付できませんでした。",
    readFailed: "Workspace の画像を読み取れませんでした。",
  },
  queue: {
    limit: "キューに追加できるメッセージは {{count}} 件までです。",
    chatBudget: "この Chat のキュー添付ファイルが 256 MiB を超えています。",
    enqueueFailed: "メッセージをキューに追加できませんでした。",
    globalBudget: "すべての Chat のキュー添付ファイルが 1 GiB を超えています。",
    frozenBudget: "確定したメッセージ添付がキューのメモリ上限を超えています。",
    workspaceChanged: "Workspace が変更されました。ローカルのキューメッセージ {{removed}} 件を削除し、送信済みまたは照合中の {{retained}} 件は確認用に保持しました。新しい Workspace では再送できません。",
  },
  userInput: {
    expired: "この質問は期限切れです。Agent が続行するまでお待ちください。",
    answerRequired: "続行する前に回答を入力してください。",
  },
  browser: {
    invalidAddress: "http(s) URL またはドメインを入力してください。",
    desktopOnly: "Browser はデスクトップアプリでのみ利用できます。",
    back: "戻る",
    forward: "進む",
    reload: "再読み込み",
    addressLabel: "ブラウザーのアドレス",
    addressPlaceholder: "URL を入力",
    opening: "Web ページを開いています…",
    agentControlling: "Agent がブラウザーを操作中",
    stopAgentAction: "Agent のブラウザー操作を停止",
    stop: "停止",
    operationFailed: "ブラウザー操作に失敗しました。",
  },
  dock: {
    latestTurn: "最新のターン",
    collapseLatest: "最新のターンを閉じる",
    expandLatest: "最新のターンを開く",
    newReply: "新しい返信",
  },
  subagent: {
    detailUnavailable: "リアルタイムの詳細は利用できません。",
    starting: "起動中…",
    noTranscript: "トランスクリプトは記録されませんでした。",
    active: "実行中",
    done: "完了",
    empty: "この会話にはまだ Subagent がいません。",
    back: "Subagent 一覧に戻る",
    detailLimit: "リアルタイム詳細が上限に達しました。この Subagent の名前と状態は引き続き確認できます。",
    avatarLabel: "{{agent}} Subagent",
  },
  skillControl: {
    capabilityChecking: "Plan 機能を確認中です。しばらくしてから再試行してください。",
    workspaceChanged: "ワークスペースが変わりました。再試行してください。",
    planUnavailable: "現在の Agent は Plan モードをサポートしていません。",
    invalidated: "この Skill は変更または削除されました。チップを削除して選び直してください。",
  },
  skillFailure: {
    "ref-invalid": "この Skill は利用できません。チップを削除して選び直してください。",
    "requirement-blocked": "現在の Agent または Plan モードではこの Skill を利用できません。",
    "file-too-large": "この Skill は大きすぎるため安全に読み込めません。",
    "changed-during-read": "読み込み中に Skill が変更されました。再試行してください。",
    "plan-unsupported": "現在の Agent は Plan モードをサポートしていません。",
    "invalid-request": "Skill リクエストが無効です。",
    "staging-rejected": "Skill を安全にステージできませんでした。",
    "package-invalid": "Skill パッケージが無効です。",
    unavailable: "Skills は一時的に利用できません。",
    conflict: "Skills の状態が変わりました。更新して再試行してください。",
    "read-only": "Skills 管理は現在読み取り専用です。",
    failed: "Skill 操作に失敗しました。再試行してください。",
  },
  suggestions: {
    chats: "チャット", files: "ファイル", skills: "Skills",
    loadingChats: "チャットを読み込み中…", loadingSkills: "Skills を読み込み中…",
    noChats: "利用できるチャットはありません", noSkills: "利用できる Skill はありません",
    sectionDescription: "{{agent}} が処理", historyDescription: "{{agent}} から取り込んだ会話",
    hiddenSkills: "一致する Skill がほかに {{count}} 件あります。検索を絞り込んでください。",
    filesTruncated: "一部のリポジトリファイルは索引されていません。検索を絞り込んでください。",
  },
};
