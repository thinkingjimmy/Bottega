/**
 * [INPUT]: Shared native/Web branch and Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the Simplified Chinese Chat composer catalog with the exact English structure
 * [POS]: Simplified Chinese Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/zh-cn";
import { branchZhCn } from "@ai-chat/chat-ui/branch-copy/zh-cn";
import { projectSelectorZhCn } from "@ai-chat/chat-ui/project-copy";

export const chatComposerZhCN: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "默认",
    standardSpeed: "标准",
  },
  approval: sharedComposer.approval,
  branch: branchZhCn,
  surface: {
    plan: "Plan",
    authorizeFileFailed: "无法授权文件 {{file}}",
    branchBusy: "请等待分支操作完成后再发送。",
    fileAuthorizationBusy: "请等待文件授权完成后再发送。",
    previewMarkdown: "预览 Markdown",
    previewWorkspaceFile: "预览 Workspace 文件",
    queueSubmit: "加入队列",
  },
  plan: sharedComposer.chat.composer.plan,
  project: projectSelectorZhCn,
  userInput: sharedComposer.userInput,
  queue: sharedComposer.chat.composer.queue,
};
