/**
 * [INPUT]: Depends on the settingsAboutEn structural type
 * [OUTPUT]: Provides settingsAboutZhCN, the Simplified Chinese Settings › About catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/about; loaded on demand by the matching top-level locale
 */

import type { settingsAboutEn } from "./en";

export const settingsAboutZhCN: typeof settingsAboutEn = {
  title: "关于",
  tagline: "macOS Agent 工作台",
  version: "版本 {{version}}",
  licenseName: "MIT License",
  readLicense: "查看 MIT License",
  licenseUnavailable: "安装包内的协议文件不可用，请在线查看唯一正本。",
  licenseCanonical: "查看在线正本",
  copy: "复制",
  copied: "已复制",
  copyDiagnostics: "复制版本信息",
  links: "链接",
  repository: "源代码仓库",
  feedback: "反馈问题",
  feedbackDescription: "搜索已知问题或提交新问题",
  releaseNotes: "发行说明",
  releaseNotesDescription: "查看每个版本的变更",
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
  checkedAt: " · 检查于 {{time}}",
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
