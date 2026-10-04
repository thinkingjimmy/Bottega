/**
 * [INPUT]: Depends on the settingsToolsEn structural type
 * [OUTPUT]: Provides settingsToolsJa, the Japanese Settings Tools catalog
 * [POS]: Japanese leaf of shared/i18n/locales/settings/tools; loaded on demand by the matching top-level locale
 */

import type { settingsToolsEn } from "./en";

export const settingsToolsJa: typeof settingsToolsEn = {
  globalScopeNote: "ここでの設定はグローバルに適用されます。Project はこの既定値を変更せず個別に上書きできます。",
  supportReason: {
    "runtime-unavailable": "ランタイムを利用できません", "builtin-tools-unsupported": "組み込みツールは未対応です", "transport-unsupported": "この転送方式は未対応です",
    "turn-origin-unsupported": "このターンの起点では利用できません", "plan-mode-unsupported": "Plan ターンでは利用できません", "security-policy": "セキュリティポリシーによりブロックされています", unknown: "Backend を利用できません",
    minimumRuntimeVersion: "ランタイム {{minimumVersion}} 以降が必要です（検出: {{detectedVersion}}）", unknownVersion: "不明なバージョン",
  },
  builtin: {
    title: "組み込みツール", saveFailed: "組み込みツール設定を保存できませんでした", disabledCount: "{{count}} 件オフ",
    globalDescription: "グローバル既定値は次のターンから反映され、Project ごとに各ツールを上書きできます。",
    projectDescription: "この Project のツール使用意図を選びます。上書きをリセットするとグローバル既定値に戻ります。",
    resetAll: "Project のツール上書きをすべてリセット", resetOne: "{{name}} をグローバル既定値に戻す",
    source: { "global-default": "グローバル既定", "project-override": "Project 上書き" },
    effective: { enabled: "有効", disabled: "無効", unavailable: "使用意図は有効ですが Backend を利用できません" },
    domain: { sections: "Sections", subagents: "Subagents", projects: "Projects", bases: "Bases", search: "検索", browser: "ブラウザ", design: "デザイン", apps: "アプリ" },
    items: {
      list_sections: { label: "Sections を一覧表示", hint: "すべての永続チャットと Base の概要を表示します。" },
      read_section: { label: "Section を読む", hint: "別のチャットの保存済みトランスクリプトを読みます。" },
      send_to_section: { label: "Section に送信", hint: "別のチャットにメッセージをキューし、Agent を起動します。" },
      create_section: { label: "Section を作成", hint: "表示・再開できる永続コラボレーションチャットを作成します。" },
      promote_result_to_section: { label: "Subagent の結果を昇格", hint: "現在のターンが所有する Subagent の結果を idle な Section に昇格します。呼び出しが遅いと切り詰められた複製しか残りません。" },
      export_attachment: { label: "添付をエクスポート", hint: "メッセージ画像をローカルに出力します。人間のターンのみ利用できます。" },
      spawn_subagent: { label: "Subagent を開始", hint: "現在のターンで単発サブタスクを委任し、結果を待ちます。" },
      convert_chat_to_project: { label: "Chat を Project に変換", hint: "現在のチャットを Project に昇格します。Codex/Claude の人間ターンのみ利用できます。" },
      base_describe: { label: "Base を説明", hint: "Base のメタデータ、列、revision を読みます。" },
      read_base: { label: "Base を読む", hint: "Base の行を絞り込み、並べ替え、ページ取得します：現在の chat の Base、別 Section の Base、添付 App の Base。" },
      base_export_csv: { label: "Base CSV を出力", hint: "Base の照会結果を CSV で出力します。" },
      base_set_view: { label: "Base ビューを設定", hint: "現在の Base ビュー設定を更新します。" },
      base_update_columns: { label: "Base 列を更新", hint: "既存列の名前や設定を変更します。" },
      base_add_columns: { label: "Base 列を追加", hint: "Base に新しい列を追加します。" },
      base_insert_rows: { label: "Base 行を挿入", hint: "現在の Base または接続済み App の Base に行を追加します。" },
      base_patch_rows: { label: "Base 行を編集", hint: "Base の行をフィールド単位で更新します。" },
      base_delete_rows: { label: "Base 行を削除", hint: "Base から指定した行を削除します。" },
      search_chat_history: { label: "チャット履歴を検索", hint: "Sections 全体からタイトルとトランスクリプトを探します。" },
      read_chat_history: { label: "このチャットの履歴を読む", hint: "現在のチャットに保存された過去のメッセージを読みます。" },
      search_bases: { label: "Bases を検索", hint: "Base owner 全体から名前、列、セル文字列を探します。" },
      browser_open: { label: "Web ページを開く", hint: "HTTP(S) ページを開きます。Plan ターンでは利用できません。" },
      browser_snapshot: { label: "Web ページのスナップショットを読む", hint: "アクセシビリティツリーを読みます。Plan ターンでは利用できません。" },
      browser_act: { label: "Web ページを操作", hint: "Web ページ操作をまとめて実行します。Plan ターンでは利用できません。" },
      browser_tabs: { label: "Web タブを一覧表示", hint: "表示中とこの Section 所有のタブを表示します。Plan ターンでは利用できません。" },
      browser_close: { label: "Web タブを閉じる", hint: "この Section が所有するタブを閉じます。Plan ターンでは利用できません。" },
      design_render_check: { label: "Design の描画を確認", hint: "現在の Design キャンバスを描画し、スクリーンショットと anti-slop の指摘を返します。" },
      validate_app: { label: "App を検証", hint: "App 編集セッションで現在のパッケージを検証します。" },
    },
  },
  mcp: {
    title: "MCP Servers",
    globalDescription: "グローバル MCP server を管理します。Project はこの一覧を変更せず継承または上書きできます。",
    projectDescription: "Project server はこの Project 専用です。継承したグローバル server はここで上書きできます。",
    globalEmptyHint: "ここにグローバル server を追加します。Project 所有 server はこのページに表示されません。",
    bridgeMissing: "この環境では MCP server 設定を利用できません。",
    projectGroup: "Project servers", projectGroupEmpty: "Project 所有 server はありません",
    inheritedGroup: "継承したグローバル servers", inheritedGroupEmpty: "継承できるグローバル server はありません",
    allInherited: "この Project は現在、継承したグローバル server 設定のみを使用しています。",
    editGlobally: "Settings でグローバル MCP servers を編集", resetOne: "{{name}} をグローバル既定値に戻す",
    conflict: "server が別の場所で更新されました。最新状態を読み込み、下書きは保持しました。",
    source: { "global-default": "グローバル既定", "project-override": "Project 上書き", "project-owned": "Project 所有" },
    effective: { enabled: "有効", disabled: "無効", unavailable: "使用意図は有効ですが Backend を利用できません" },
    add: "server を追加", edit: "編集", delete: "{{name}} を削除", emptyTitle: "MCP server はまだありません",
    addTitle: "MCP server を追加", editTitle: "MCP server を編集", dialogDescription: "stdio のみ対応し、command は絶対パスが必要です。保存後、次の人間の非 Plan ターンに server 全体を注入します。",
    name: "名前", command: "command の絶対パス", args: "引数（1 行に 1 つ）", environment: "環境変数", addVariable: "変数を追加", envName: "環境変数名", envNewValue: "{{name}} の新しい値", envFallbackName: "環境変数", retainValue: "空欄なら現在の値を保持", value: "値", removeVariable: "{{name}} を削除", envNameRequired: "環境変数名は空にできません", envValueRequired: "{{name}} の新しい値を入力してください", descriptionLine: "{{transport}}・{{target}}・{{eligibility}}・{{health}}",
    eligibility: { eligible: "次の人間の非 Plan ターンで有効", "remote-policy-unsupported": "Remote チャネルはまだ利用できません", "authenticated-remote-unsupported": "静的 Header 付き authenticated remote は未対応", "query-remote-unsupported": "query 付き remote URL は未対応" },
    health: { unobserved: "状態未確認", healthy: "プロトコル成功", degraded: "プロトコル失敗、再試行待ち", quarantined: "プロセス状態不明、隔離済み" },
  },
};
