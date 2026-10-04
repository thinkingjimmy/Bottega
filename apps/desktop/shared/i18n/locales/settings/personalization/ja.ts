/**
 * [INPUT]: Depends on the settingsPersonalizationEn structural type
 * [OUTPUT]: Provides settingsPersonalizationJa, the Japanese Settings › Personalization catalog
 * [POS]: Japanese leaf of shared/i18n/locales/settings/personalization; loaded on demand by the matching top-level locale
 */

import type { settingsPersonalizationEn } from "./en";

export const settingsPersonalizationJa: typeof settingsPersonalizationEn = {
  title: "パーソナライズ", sectionTitle: "カスタム指示", description: "インストール済み Agent ごとのグローバル指示ファイルを編集します。",
  loading: "指示ファイルを読み込み中…", emptyTitle: "Agent がインストールされていません", emptyHint: "バックエンド設定で Agent をインストールしてから戻ってください。",
  placeholder: "この Agent へのプレーンテキスト指示を入力…", createHint: "ファイルはまだありません。保存すると {{path}} に作成します。",
  save: "指示を保存", saving: "保存中…", copyPath: "パスをコピー", copied: "パスをコピーしました", reveal: "ファイルマネージャーで表示",
  oversized: "256 KiB を超えるため、ここでは読み込みも編集もしません。",
  find: { open: "ファイル内を検索", placeholder: "ファイル内を検索", count: "{{current}} / {{total}}", noMatches: "一致なし", previous: "前の一致", next: "次の一致", close: "検索を閉じる" },
  metrics: { lines: "{{lines}} 行", limit: "上限 {{size}}", recommendedLines: "推奨は {{lines}} 行以内", recommendedSize: "推奨は {{size}} 以内" },
  errors: { bridge: "このビルドではパーソナライズを利用できません。", conflict: "アプリ外でファイルが変更されました。未保存の編集は保持されています。再度保存するとディスク上の新しい版を上書きします。", tooLarge: "指示は 256 KiB 以下にしてください。", oversizedFile: "256 KiB を超えるため編集できません。", symlinkUnresolvable: "シンボリックリンクが壊れているか循環しています。", readFailed: "指示ファイルを安全に読み込めませんでした。", writeFailed: "指示ファイルを保存できませんでした。" },
};
