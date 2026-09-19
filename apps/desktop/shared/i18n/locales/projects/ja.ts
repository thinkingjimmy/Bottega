/**
 * [INPUT]: Depends on the projectsEn structural type
 * [OUTPUT]: Provides projectsJa, the Japanese Sidebar Projects catalog
 * [POS]: Japanese leaf of shared/i18n/locales/projects; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/ja";


import type { projectsEn } from "./en";

export const projectsJa: typeof projectsEn = {
  provider: {
    loadFailed: "Project の読み込みに失敗しました：{{message}}",
    addFailed: "Project の追加に失敗しました：{{message}}",
    appProjectFailed: "App Project の作成に失敗しました：{{message}}",
    renameFailed: "Project の名前変更に失敗しました：{{message}}",
    appearanceFailed: "Project の外観を保存できませんでした：{{message}}",
    revealFailed: "Project をシステムのファイルマネージャーに表示できませんでした：{{message}}",
    sortFailed: "Project の並び順を保存できませんでした：{{message}}",
    coordinatorUnavailable: "Project インポートコーディネーターを利用できません。",
  },
  sortAria: workspaceCopy.project.sortLabel,
  sortLastUpdated: workspaceCopy.project.recent,
  sortManual: workspaceCopy.project.manual,
  add: "Project を追加",
  empty: "+ を押してフォルダーを追加",
  showMore: "もっと見る",
  moreActions: workspaceCopy.project.more,
  newChatIn: "{{name}} で新しいタスク",
  missingRecord: "Project の記録が見つかりません",
  missingName: "失われた Project",
  missingFolder: "Project フォルダーが見つかりません：{{dir}}",
  editBadge: "編集",
  baseTag: "Base",
  rename: workspaceCopy.project.rename,
  renameTitle: workspaceCopy.project.renameTitle,
  renameDescription:
    workspaceCopy.project.renameDescription,
  moveChatsToRoot: "チャットをルートへ戻す",
  rescue: {
    title: "この Project からチャットを移動しますか？",
    description: "この Project のローカル記録がありません。確認済みのチャットは通常のチャットとしてルートへ移り、次回の続行時に新しい Agent セッションを開始します。",
    retry: "復旧状況を確認",
    pending: "クラウドの確認を待っています。元のチャットは保持されています。",
    conflicted: "クラウドの内容が変更されました。元のチャットを保持すると、この復旧を取り消します。",
    confirmed: "確認済みです。ローカルの移動を完了しています。",
    keepOriginal: "元のチャットを保持",
    failed: "移動は完了していません。状態を確認して再試行してください。",
    more: "ほかにも待機中のチャットがあります。このグループを確認すると次が表示されます。",
    untitled: "無題のチャット",
  },
  unbound: {
    badge: "フォルダが必要",
    tooltip:
      "このパソコンにはこの Project のフォルダがまだありません。選択すると作業を始められます。",
    chooseFolder: "フォルダを選択…",
    chooseFailed: "Project フォルダを設定できませんでした：{{message}}",
    turnRefused:
      "このパソコンにはこの Project のフォルダがありません。タスクを始める前に Project メニューからフォルダを選択してください。",
  },
  removeLocal: "ローカル Project を削除",
  removeLocalTitle: "{{name}} を削除しますか？",
  removeLocalDescription:
    "アプリからローカル Project だけを削除します。コンピューター上のファイルと既存のチャットは削除されません。",
  archiveInsteadTitle: "代わりに {{name}} をアーカイブしますか？",
  archiveInsteadBase:
    "この Project は Project Base を所有しているため、安全に削除できません。代わりにアーカイブすると、Project、Base、ファイル、チャットがそのまま保持されます。",
  archiveInsteadMemory:
    "共有 group Memory はこの Project に属しているため、安全に削除できません。代わりにアーカイブすると、Project、Memory、ファイル、チャットがそのまま保持されます。",
  archiveInsteadManaged:
    "この Project には managed worktree チャットが残っているため、作業フォルダーを安全に解除できません。代わりにアーカイブするか、先に managed チャットを完全削除してください。",
  archiveInsteadBoth:
    "この Project は Project Base と共有 group Memory を所有しているため、安全に削除できません。代わりにアーカイブすると、すべてのデータがそのまま保持されます。",
  archiveInsteadConfirm: "Project をアーカイブ",
  archive: workspaceCopy.project.archive,
  hideAppProject: "Projects から非表示",
  archiveTitle: workspaceCopy.project.archiveTitle,
  archiveDescription:
    "「{{name}}」と {{chats}} 件のチャットが Sidebar から外れます。Settings › Archive で復元または完全削除できます。外部および App の作業フォルダーは削除されません。",
  archiveRootBases: "一緒にアーカイブされるルート Base：{{bases}} 件。",
  appearance: workspaceCopy.project.appearance,
};
