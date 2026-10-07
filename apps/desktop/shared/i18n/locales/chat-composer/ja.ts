/**
 * [INPUT]: Shared native/Web branch and Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the Japanese Chat composer catalog with the exact English structure
 * [POS]: Japanese Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/ja";
import { branchJa } from "@ai-chat/chat-ui/branch-copy/ja";
import { projectSelectorJa } from "@ai-chat/chat-ui/project-copy";

export const chatComposerJa: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "既定",
    standardSpeed: "標準",
  },
  approval: sharedComposer.approval,
  branch: branchJa,
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
