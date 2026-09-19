/**
 * [INPUT]: Depends on the setupEn structural type
 * [OUTPUT]: Provides setupZhCN, the Simplified Chinese Setup catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/setup; loaded on demand by the matching top-level locale
 */

import type { setupEn } from "./en";

export const setupZhCN: typeof setupEn = {
  configure: "配置",
  provider: {
    mainWindowOnly: "请在主窗口管理 Agent 环境。",
  },
  install: "安装", login: "登录", manageLogin: "管理登录", update: "可更新",
  updateAria: "更新 {{backend}}", recheck: "重新检测 {{backend}}",
  checkAgain: "重新检测",
  updateNow: "更新",
  reinstall: "重新安装",
  more: "{{backend}} 的更多操作",
  completed: "我已完成，重新检测",
  checkedAt: "上次检查：{{time}}",
  state: {
    installed: "已安装，可尝试",
    previouslyReady: "上次检查已就绪",
    checkFailed: "检测未完成",
    waiting: "等待终端操作",
    updateRequired: "需要更新",
    signInRequired: "需要登录",
  },
  verification: {
    unverified: "登录状态将在首次对话时确认。",
    expired: "以下保留了上次成功检查的结果。",
    failed: "本次检测未能完成，已保留上次结果。请重新检测。",
    updateRequired: "当前版本 {{version}}，需要 {{minimum}} 或更高版本。",
    signInRequired: "登录后即可使用此 Agent。",
    cannotCheck: "暂时无法检查安装情况，请重新检测以确认状态。",
    cannotStart: "此 Agent 未能启动。请重新检测，或在更多菜单中重新安装。",
    waiting: "完成终端操作后返回此窗口，将自动重新检测。",
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
  checkIssue: {
    timeout: "检测超时，请稍后重新检测。",
    connection: "检测时无法连接服务，请检查网络连接后重试。",
    busy: "Agent 正在忙，请等待当前操作完成后重新检测。",
    failed: "检测未能完成，可查看下方详情后重试。",
  },
  guide: {
    claude: { install: "请先安装 Claude Code。", login: "请在终端运行 `claude auth login`。" },
    codex: { install: "请先安装 Codex CLI。", login: "请在终端运行 `codex login`。" },
    kimi: { install: "请先安装 Kimi Code。", login: "请在终端运行 `kimi login`。" },
    opencode: { install: "请先安装 OpenCode。", login: "请在终端运行 `opencode auth login`。" },
  },
};
