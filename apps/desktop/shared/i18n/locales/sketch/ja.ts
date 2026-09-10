/**
 * [INPUT]: Defines pure ja Sketch interface copy.
 * [OUTPUT]: Provides sketchJa for editor and attachment lifecycle messages.
 * [POS]: Feature locale leaf assembled by the matching language catalog.
 */
export const sketchJa = {
  title: "スケッチ",
  description: "メッセージに添える画像を描きます。",
  done: "完了",
  processing: "スケッチを処理中",
  discardTitle: "変更を破棄しますか？",
  discardDescription: "変更は保存されません。",
  continueEditing: "編集を続ける",
  discardChanges: "変更を破棄",
  edit: "クリックしてスケッチを編集",
  select: "選択",
  pen: "ペン",
  text: "テキスト",
  shapeTool: "図形",
  eraser: "消しゴム",
  undo: "元に戻す",
  redo: "やり直す",
  canvas: "スケッチキャンバス",
  canvasHelp:
    "描画または選択。矢印で移動、Deleteで削除、CommandまたはControl Zで元に戻します。",
  penWidth: "ペンの太さ",
  eraserWidth: "消しゴムの直径",
  color: "色 {{value}}",
  customColor: "カスタムカラー",
  sampleColor: "キャンバスから色を選択",
  red: "赤",
  green: "緑",
  blue: "青",
  textInput: "スケッチのテキスト",
  busyErasing: "消去を完了しています…",
  historyTrimmed: "古い取り消し履歴を削除しました。",
  error: "操作を完了できませんでした。再試行してください。",
  empty: "先に内容を追加してください。",
  sourceMissing: "編集用データがありません。元のスケッチを保持しています。",
  ownerExpired: "このチャットは利用できません。",
  readOnly: "このチャットは現在編集できません。",
  versionChanged: "添付が変更されました。閉じて最新の版を開いてください。",
  migrationActive: "ウィンドウの移動後に再試行してください。",
  editorActive: "先にスケッチを完了するか閉じてください。",
  attachmentLimit: "直接添付できるファイルは8個までです。",
  imageTooLarge: "PNGが8 MiBを超えています。内容を減らしてください。",
  budget: "編集の上限を超えました。作品は保持されています。",
  resizeBudget: "拡大が編集の上限を超えています。サイズを小さくしてください。",
  eraseBudget:
    "消去の処理上限を超えました。消去前の内容を保持しました。図形や内容を減らしてください。",
  exportFailed:
    "PNGを作成できませんでした。スケッチは保持されています。再試行してください。",
  workerFailed:
    "消去できませんでした。スケッチは変更されていません。再試行してください。",
  textOverflow:
    "文字がキャンバス外です。短くするか、編集をキャンセルして移動・縮小してください。",
  handle: "{{direction}}をサイズ変更",
  shape: {
    line: "直線",
    arrow: "矢印",
    rectangle: "長方形",
    circle: "円",
    triangle: "三角形",
    diamond: "ひし形",
    star: "星",
    heart: "ハート",
  },
};
