/**
 * [INPUT]: Depends on the settingsUpdatesEn structural type
 * [OUTPUT]: Provides settingsUpdatesZhCN, the Simplified Chinese Settings › Updates catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/updates; loaded on demand by the matching top-level locale
 */

import type { settingsUpdatesEn } from "./en";

export const settingsUpdatesZhCN: typeof settingsUpdatesEn = {
  title: "更新",
  description: "管理 Bottega 与各 Provider CLI 的更新。",
  updateAll: "全部更新",
  updateOne: "更新 {{name}}",
  upToDate: "{{name}} 已是最新",
  updating: "正在更新 {{name}}…",
  latestUnknown: "最新版本未知",
  cliFailed: "更新失败",
  cliUnchanged: "更新程序已结束，但版本没有变化。可以试试在终端中更新。",
  cliTimeout: "更新耗时过长，已停止。",
  cliUnavailable: "这个 CLI 无法在这里更新。",
  retry: "重试",
  log: "日志",
  terminal: "在终端中更新",
  empty: "还没有安装任何 Provider CLI。",
  checking: "正在检查更新…",
  current: "已是最新{{checkedAt}}",
  available: "发现新版本 {{version}}",
  downloading: "正在下载 {{version}}",
  installing: "更新已下载 · 即将重启安装",
  failed: "更新失败：{{message}}",
  failedUnknown: "更新失败，原因未知。",
  failedFallback: "自动更新未能完成。请打开 Releases 页面下载 {{version}}。",
  failedResolution: "请从 Releases 页面下载新版本，或在 GitHub 反馈问题。",
  backgroundFailed: "上次自动检查失败",
  backgroundFailedOpen: "自动检查更新持续失败，点击查看详情",
  check: "检查更新",
  upgrade: "立即升级",
  manualUpgrade: "打开下载页",
  unavailable: "更新服务仅在安装包中可用",
  platformSupport: "平台支持",
  preview: "{{platform}} 预览版",
  previewDescription:
    "已支持打包、启动与更新；以下能力须等待对应系统的托管与围栏契约闭合后才开放：",
  features: {
    agentTurns: "Agent 对话",
    headlessSandbox: "无头 Agent 任务",
    ownedGitMutation: "受管 Git 变更",
    serverApps: "Server Apps",
    chromeImport: "Chrome 登录态导入",
    memory: "受管 Memory",
  },
};
