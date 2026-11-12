/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides projectSettingsJa, the Japanese Project Settings catalog
 * [POS]: Japanese leaf of shared/i18n/locales/project-settings; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/ja";


export const projectSettingsJa = {
  entry: workspaceCopy.project.settings, open: "Project 設定を開く", title: workspaceCopy.project.settingsTitle,
  tabs: { general: "一般", personalization: "パーソナライズ", skills: "Skills" },
  general: { sectionBasics: workspaceCopy.project.basics, name: workspaceCopy.project.identity, renameAction: "名前を変更", appearanceAria: workspaceCopy.project.appearanceLabel, memory: "Memory", memoryDisabled: "Memory サービスは無効です", memoryPaused: "Memory は一時停止中です", memoryUnavailable: "サービスを利用できません", memoryScoped: "この Project には独立した Memory スコープがあります", memoryShared: "Memory は Chat または個人スコープで共有されます", memoryDelivering: "インポートした Memory を配信中…", memoryManage: "Memory を管理", history: "History インポート", historyHint: "この Project の外部 Agent 履歴を手動でインポートします。以降の変更は再度手動でインポートしてください。", appsSection: "App", appsDescription: "追加した App はこの Project の会話で使えます。Pin は Sidebar に置くだけで、見られるデータは変わりません。", appsManagedByApp: "この App Project の権限は App ページで管理します。", placements: { pinControl: "{{name}} を Sidebar に Pin", grantSummary: "{{grant}} · {{agent}}", unavailableBadge: "利用不可", agentOn: "Agent が代わりに操作できます", agentOff: "操作できるのはあなただけ", noGrant: "まだ許可していません", unavailable: "このビルドはまだ実行できません。Apps ページで直してから Pin してください", empty: "この Project にはまだ App がありません", emptyHint: "追加すると、この Project の会話に現れます。見られるデータはあなたが決めます。", loading: "Apps を読み込み中…", failed: "Apps を読み込めませんでした。", retry: "再試行", pending: "Pin を保存中…", pinFailed: "この App の Pin を保存できませんでした。" }, baseSection: workspaceCopy.project.baseTitle, baseEmpty: workspaceCopy.project.baseEmpty, baseCreate: workspaceCopy.project.baseCreate, baseOpen: workspaceCopy.project.baseOpen, baseSummary: workspaceCopy.project.baseSummary, baseLoading: "Project Base を読み込み中", danger: workspaceCopy.project.danger, archiveHint: workspaceCopy.project.archiveHint, detachHint: "外部フォルダーを削除せずローカル記録を外します。", appLifecycleHint: "App Project は App のライフサイクルに従います。Apps ページで削除してください。" },
  instructions: { section: "Project 指示", description: "Agent がこのワークスペースで読む指示ファイルを編集します。", pointerHint: "このファイルは AGENTS.md を参照します。通常は直接編集不要です。", noWorkspace: "まず Project 行メニューでワークスペースを選択してください。", bridgeMissing: "Project Personalization を利用できません。", appReadOnly: "App generation が所有するため App Project の指示は読み取り専用です。", appEditGuide: "App ページの App Edit 会話を開いてください。", workspaceChanged: "Project のワークスペースが変更されました。下書きは保持されています。", loading: "Project 指示を読み込み中", saveFailed: "Project 指示の保存に失敗しました", outsideWorkspace: "指示ファイルが Project 外を参照しているため利用できません。", appManaged: "App Project の指示は App generation が管理します。" },
  skills: {
    empty: "この Project に Skills はありません",
    emptyHint: "{{dir}}/.agents/skills/<name>/SKILL.md に配置して更新してください。",
    noWorkspace: "Project ワークスペースが未選択です",
    noWorkspaceHint: "Project のメニューからワークスペースを選ぶと、Project Skills を追加できます。",
    loadFailed: "Project Skills を読み込めませんでした。",
    badge: { repo: "Project", user: "ユーザー", system: "システム", admin: "管理", extension: "拡張" },
  },
};
