/**
 * [INPUT]: Fixed seven-day client search and measured incomplete-cache states.
 * [OUTPUT]: Shared localized command groups, search, coverage and refresh-protection copy.
 * [POS]: Cloud copy catalog; index progress never implies that chat drafts are saved.
 */
import type { CloudSearchCopy } from "./en";
export const ja: CloudSearchCopy = {
  "results": "検索結果",
  "actions": "クイック操作",
  "label": "チャットを検索",
  "placeholder": "検索語を入力",
  "scope": "チャットのタイトルと過去7日間のメッセージを検索します。",
  "preparing": "過去7日間の検索を準備中です。結果は不完全な場合があります。",
  "updating": "検索を更新中です。結果は不完全な場合があります。",
  "ready": "検索の準備ができました。",
  "limited": "検索範囲は不完全です。時刻が不明な内容や、現在のリソース上限を超える内容があります。",
  "paused": "検索は一時停止中です。接続して更新を再試行してください。",
  "storageFailed": "暗号化された検索キャッシュを保存できませんでした。このページでは検索できますが、再読み込み後に再構築が必要になる場合があります。",
  "unsaved": "検索を準備中です。再読み込みすると、未保存の進捗を再処理する場合があります。",
  "progress": "タイトル {titles} 件・メッセージ {messages} 件を索引済み",
  "searching": "検索中…",
  "empty": "一致する内容はありません。",
  "emptyPartial": "準備済みの内容には一致しません。検索範囲はまだ不完全です。",
  "resultsLimited": "最初の100件を表示しています。検索語を追加して絞り込んでください。",
  "stale": "この結果は変更されたか、利用できなくなりました。再度検索してください。",
  "retry": "検索の準備を再試行",
  "untitled": "無題のチャット",
  "titleHit": "チャットのタイトル",
  "messageHit": "メッセージ",
  "queryInvalid": "256文字、16語以内で入力してください。"
};
