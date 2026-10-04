/**
 * [INPUT]: Depends on the setupEn structural type
 * [OUTPUT]: Provides setupZhCN, the Simplified Chinese Setup catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/setup; loaded on demand by the matching top-level locale
 */

import type { setupEn } from "./en";

export const setupZhCN: typeof setupEn = {
  provider: {
    mainWindowOnly: "请在主窗口管理 Agent 环境。",
  },
  install: "安装", login: "登录",
  checkAgain: "重新检测",
  completed: "我已完成，重新检测",
  state: {
    installed: "已安装，可尝试",
    previouslyReady: "上次检查已就绪",
    checkFailed: "检测未完成",
    waiting: "等待终端操作",
    updateRequired: "需要更新",
    signInRequired: "需要登录",
  },
  feedback: {
    load: "无法加载 Agent 状态",
    check: "未能完成检测",
    install: "未能打开安装",
    update: "未能打开更新",
    login: "未能打开登录",
    clipboard: "命令已复制",
    clipboardFailed: "未能复制命令",
    pasteCommand: "请在终端粘贴并执行命令，完成后重新检测。",
    retryHint: "请重试，原有 Agent 状态已保留。",
  },
  guide: {
    claude: { install: "请先安装 Claude Code。", login: "请在终端运行 `claude auth login`。" },
    codex: { install: "请先安装 Codex CLI。", login: "请在终端运行 `codex login`。" },
    kimi: { install: "请先安装 Kimi Code。", login: "请在终端运行 `kimi login`。" },
    opencode: { install: "请先安装 OpenCode。", login: "请在终端运行 `opencode auth login`。" },
  },
};
