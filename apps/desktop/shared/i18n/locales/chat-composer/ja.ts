/**
 * [INPUT]: Shared native/Web Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the Japanese Chat composer catalog with the exact English structure
 * [POS]: Japanese Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/ja";
import { projectSelectorJa } from "@ai-chat/chat-ui/project-copy";

export const chatComposerJa: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "既定",
    standardSpeed: "標準",
  },
  approval: sharedComposer.approval,
  branch: {
    uncommitted_one: "未コミットのファイル {{count}} 件",
    uncommitted_other: "未コミットのファイル {{count}} 件",
    loadFailed: "ブランチを読み込めませんでした",
    checkoutFailed: "ブランチを切り替えられませんでした",
    createFailed: "ブランチを作成できませんでした",
    fallback: "ブランチ",
    search: "ブランチを検索",
    empty: "ブランチが見つかりません",
    detached: "Detached HEAD",
    group: "ブランチ",
    refreshing: "ブランチを更新中…",
    newAction: "新しいブランチを作成して切り替える…",
    createTitle: "ブランチを作成して切り替える",
    createDescription: "現在の HEAD からローカルブランチを作成して切り替えます。",
    name: "ブランチ名",
    placeholder: "new-branch",
    close: "閉じる",
    creating: "作成中…",
    createAndCheckout: "作成して切り替える",
  },
  surface: {
    plan: "Plan",
    authorizeFileFailed: "{{file}} を承認できませんでした",
    branchBusy: "ブランチ操作が完了してから送信してください。",
    fileAuthorizationBusy: "ファイル承認が完了してから送信してください。",
    previewMarkdown: "Markdown をプレビュー",
    previewWorkspaceFile: "Workspace ファイルをプレビュー",
    queueSubmit: "キューに追加",
  },
  plan: sharedComposer.chat.composer.plan,
  project: projectSelectorJa,
  userInput: sharedComposer.userInput,
  queue: sharedComposer.chat.composer.queue,
};
