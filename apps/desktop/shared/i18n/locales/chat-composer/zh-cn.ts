/**
 * [INPUT]: Shared native/Web Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the Simplified Chinese Chat composer catalog with the exact English structure
 * [POS]: Simplified Chinese Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/zh-cn";
import { projectSelectorZhCn } from "@ai-chat/chat-ui/project-copy";

export const chatComposerZhCN: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "默认",
    standardSpeed: "标准",
  },
  approval: sharedComposer.approval,
  branch: {
    uncommitted_one: "{{count}} 个未提交文件",
    uncommitted_other: "{{count}} 个未提交文件",
    loadFailed: "无法加载分支",
    checkoutFailed: "无法切换分支",
    createFailed: "无法创建分支",
    fallback: "分支",
    search: "搜索分支",
    empty: "没有找到分支",
    detached: "游离 HEAD",
    group: "分支",
    refreshing: "正在刷新分支…",
    newAction: "创建并切换到新分支…",
    createTitle: "创建并切换分支",
    createDescription: "从当前 HEAD 创建本地分支并切换过去。",
    name: "分支名称",
    placeholder: "new-branch",
    close: "关闭",
    creating: "正在创建…",
    createAndCheckout: "创建并切换",
  },
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
