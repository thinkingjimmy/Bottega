/**
 * [INPUT]: Depends on the settingsBrowserEn structural type
 * [OUTPUT]: Provides settingsBrowserJa, the Japanese Settings › Browser catalog
 * [POS]: Japanese leaf of shared/i18n/locales/settings/browser; loaded on demand by the matching top-level locale
 */

import type { settingsBrowserEn } from "./en";

export const settingsBrowserJa: typeof settingsBrowserEn = {
  detecting: "Chrome を検出中…",
  noProfiles: "Google Chrome または利用可能な profile が見つかりません。",
  detectFailed: "Chrome profile を検出できませんでした。",
  platformUnavailable: "このプレビュー版では Chrome ログインの取り込みは利用できません。",
  guideTitle: "Bottega で Chrome のサインイン状態を使う",
  guideDescription:
    "選択したサイトのサインイン状態を読み込み、Agent があなたとしてブラウズできるようにします。読み込み前にプロファイルとサイトを選べます。",
  guideAction: "Chrome から読み込む…",
  facts: {
    readOnlyTitle: "読み取り専用",
    readOnlyDetail: "Chrome は変更されません。",
    localTitle: "この Mac に留まる",
    localDetail: "Cookie はアップロードされません。",
    keychainTitle: "キーチェーンへのアクセス",
    keychainDetail: "macOS の確認は一度だけ。拒否しても Chrome には影響しません。",
  },
  lastImport: "前回の読み込み",
  result: "インポート {{imported}} / スキップ {{skipped}} / 失敗 {{failed}}",
  resultFallback:
    "一部のサイトをインポートできませんでした。Browser で一度ログインすれば、セッションが保持され Agent にも引き継がれます。",
  dialogTitle: "Chrome からログイン状態をインポート",
  dialogDescription:
    "profile と対象ドメインを選択します。ドメインは初期状態ですべて選択され、個別に解除できます。Chrome のデータは変更されません。",
  profile: "Chrome profile",
  cookieDomains: "Cookie ドメイン",
  selectedDomains: "{{domains}} ドメインを選択、約 {{cookies}} 件の永続 Cookie",
  selectAll: "すべて選択",
  deselectAll: "すべて解除",
  loadingDomains: "ドメインを読み込み中…",
  previewUnknown: "不明なエラー",
  previewFailed: "この profile の Cookie ドメインを読み込めませんでした。",
  previewFailureTruth:
    "この profile の Cookie を読めませんでしたが、ログイン状態がないとは限りません。",
  noCookies: "この profile にはインポート可能な永続 Cookie がありません。",
  keychainNotice:
    "続行すると macOS が「Chrome Safe Storage」へのアクセスを求めます。復号と書き込みはこの Mac 上だけで行われ、Cookie はアップロードされません。拒否しても Chrome には影響しません。",
  importAction: "ログイン状態をインポート",
  importFailed:
    "ログイン状態をインポートできませんでした。Browser で一度ログインすればセッションを保持できます。",
};
