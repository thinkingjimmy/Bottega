/**
 * [INPUT]: Depends on the chatSurfacesEn structural type
 * [OUTPUT]: Provides the Japanese Chat surfaces catalog with the exact English structure
 * [POS]: Japanese Chat surfaces locale leaf assembled into the existing chat namespace
 */

import { chatSurfacesEn } from "./en";

export const chatSurfacesJa: typeof chatSurfacesEn = {
  sidePanel: {
    shell: {
      loadingBase: "Base を読み込み中",
      closePreview: "プレビューを閉じる",
      readingFile: "ファイルを読み込み中…",
      bytes: "{{count}} バイト",
      resize: "サイドパネルの幅を変更",
      resizeHint: "ドラッグまたは矢印キーでサイドパネルの幅を変更",
    },
    appGrant: {
      badgeAria: "{{name}} の権限 —— データ：{{data}}、代わりに操作：{{delegation}}",
      on: "オン",
      off: "オフ",
      omittedIntro: "前のターンで Agent はこの App を見ていません —— {{reason}}",
      omission: {
        referenceLimit:
          "この Chat に付けた App が多すぎます。いくつか外して再試行してください。",
        instructionBudget:
          "付けた App の説明が 2 KB の上限を超えています。いくつか外して再試行してください。",
        backendUnsupported:
          "現在のバックエンドにはツールチャンネルがなく、代わりの操作は使えません。読み取り専用のファイルアクセスは有効です。",
        baseToolsDisabled:
          "Base の読み書きツールが両方オフです。設定 › ツールでオンにしてください。",
      },
      degradation: {
        baseReadsDisabled:
          "このターンは行の変更だけで、テーブルは読めません：Base の読み取りがオフです。",
        baseRowMutationsDisabled:
          "このターンはテーブルを読むだけで、行は変更できません：Base の行変更がオフです。",
      },
      excludedIntro:
        "前のターンで配信されなかった Extension があり、この App は完全には動いていません：{{items}}",
      excludedItem: "{{name}}（{{code}}）",
      excludedRequiredItem: "{{name}}（{{code}}、必須）",

      extensionDetails: "Extension と配信の詳細",
      requirementSummary:
        "要件：{{requirement}}、インストール済み：{{installed}}、許可状態：{{admission}}、世代：{{generation}}、有効：{{enabled}}、App に許可済み：{{granted}}",
      required: "必須",
      optional: "任意",
      yes: "はい",
      no: "いいえ",
      none: "なし",
      unknown: "不明",
      unresolved: "未解決",
      configOverrideDiff: "設定の上書き：{{value}}",
      eligible: "利用可能性：{{value}}",
      deliverySummary: "配信状態：{{delivery}}、このターンで有効：{{active}}",
    },
    appTab: {
      readFailed: "App の状態を読み取れませんでした",
      surfaceFailed: "App の画面を発行できませんでした",
      unavailable:
        "App は利用できないか削除中です。スロットは保持されますが、ランタイム機能やデータ機能は発行されません。",
      stop: "App を停止",
      startFailed: "App を起動できませんでした",
      open: "App を開く",
      notAuthorized:
        "この App はこの Chat でまだ許可されていないため、データの読み取りも画面の表示もできません。",
      authorize: "この Chat で許可する",
    },
    image: {
      fallbackTitle: "画像",
      preview: "画像プレビュー",
      previewNamed: "画像プレビュー：{{name}}",
      zoom: "ズーム",
      restoring: "画像を復元中",
      reading: "画像を読み込み中",
      unavailable: "画像はこの会話に存在しないか、一時的に利用できません。",
      retry: "再試行",
    },
  },
  transcript: {
    image: {
      unavailable: "画像をプレビューできません",
      reading: "画像を読み込み中",
      generatedAlt: "生成された画像",
      openInSidePanel: "サイドパネルで画像を開く：{{title}}",
      fallbackTitle: "画像",
    },
    actions: {
      copy: "コピー",
      copied: "コピーしました",
    },
    outlineLabel: "会話のアウトライン",
    plan: {
      editingAria: "Plan を編集中",
      editing: "編集中",
      title: "Plan",
      copy: "Plan をコピー",
      copied: "コピーしました",
      collapsePanel: "Plan のサイドパネルを閉じる",
      showPanel: "サイドパネルに Plan を表示",
      showFullPanel: "サイドパネルに Plan 全体を表示",
    },
    loadEarlier: "以前のメッセージを表示",
    loadingEarlier: "以前のメッセージを読み込み中…",
    fatalResultTitle: "このターンの結果を保存できませんでした",
    fatalResultLocked: "このターンの結果を破棄するまで入力はロックされたままです。",
    abandonFatal: "このターンの結果を破棄",
    cleanupFailedTitle: "プロセスの後始末が完了していません",
    cleanupFailed:
      "{{backend}} のプロセスグループを終了できませんでした。関連プロセスの終了を確認してから、この Chat の安全ロックを解除してください。",
    acknowledgeCleanup: "プロセスの終了を確認しました",
    loadedEarlier: "以前のメッセージを {{count}} 件読み込みました",
    subagentDetailsCleared: "この Subagent の詳細は消去されました",
    subagentDetailsLimited: "リアルタイム詳細が上限に達しました",
    showLess: "折りたたむ",
    showMore: "さらに表示",
    openAttachmentInSidePanel: "サイドパネルで画像を開く：{{title}}",
    workingFor: "{{duration}} 処理中",
  },
  usageLimit: {
    unavailable: "{{backend}} は一時的に利用できません",
    resetTime: "リセット時刻",
    usageWindow: "利用枠",
    window: {
      fiveHour: "5 時間枠",
      weekly: "週間枠",
    },
    retry: "今すぐ再試行",
    resetAt: "{{date}}（{{zone}}）",
    aboutMinutes: "約 {{minutes}} 分",
    aboutHours: "約 {{hours}} 時間",
    aboutHoursMinutes: "約 {{hours}} 時間 {{minutes}} 分",
  },
};
