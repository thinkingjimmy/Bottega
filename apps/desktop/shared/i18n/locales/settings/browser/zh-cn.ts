/**
 * [INPUT]: Depends on the settingsBrowserEn structural type
 * [OUTPUT]: Provides settingsBrowserZhCN, the Simplified Chinese Settings › Browser catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/browser; loaded on demand by the matching top-level locale
 */

import type { settingsBrowserEn } from "./en";

export const settingsBrowserZhCN: typeof settingsBrowserEn = {
  sectionTitle: "从 Chrome 导入登录态",
  loginState: "Chrome 登录态",
  detecting: "正在检测 Chrome…",
  detectingAria: "正在检测 Chrome",
  readyDescription: "选择 profile 与域名后再导入。Chrome 数据只读，不会被修改。",
  noProfiles: "未发现 Google Chrome 或可用 profile。",
  detectFailed: "无法检测 Chrome profiles。",
  platformUnavailable: "当前预览版本尚不支持 Chrome 登录态导入。",
  startImport: "开始导入",
  startImportAria: "开始导入 Chrome 登录态",
  learnMore: "了解更多",
  capability: {
    persistentTitle: "登录一次，长期继承",
    persistentDetail:
      "即使跳过导入，也可直接在内嵌 Browser 登录；Cookie 会跨 tab 与应用重启保存，Agent 后续访问自动继承。",
    limitedTitle: "不导入密码、扩展与书签",
    limitedDetail:
      "Electron 没有 Chrome 密码管理器与完整扩展 API；书签不参与 Agent 浏览。避免搬运敏感数据却得不到实际功能。",
  },
  result: "已导入 {{imported}} / 跳过 {{skipped}} / 失败 {{failed}}",
  resultFallback:
    "部分站点未能导入。直接在 Browser 中登录一次即可长期保留，Agent 也会继承同一会话。",
  dialogTitle: "从 Chrome 导入登录态",
  dialogDescription:
    "选择一个 profile 和需要导入的域名。域名默认全选，可逐项取消。Chrome 数据只读，不会被修改。",
  profile: "Chrome profile",
  cookieDomains: "Cookie 域名",
  selectedDomains: "已选 {{domains}} 个域名，约 {{cookies}} 条持久 Cookie",
  selectAll: "全选",
  deselectAll: "取消全选",
  loadingDomains: "正在读取域名…",
  previewUnknown: "未知错误",
  previewFailed: "无法读取这个 profile 的 Cookie 域名。",
  previewFailureTruth: "读不到这个 profile 的 Cookie——不代表它没有登录态。",
  noCookies: "这个 profile 没有可导入的持久 Cookie。",
  keychainNotice:
    "点击后 macOS 会请求访问“Chrome Safe Storage”。解密和写入只在这台 Mac 上进行，Cookie 不会上传。取消授权不会影响 Chrome。",
  importAction: "导入登录态",
  importFailed:
    "登录态导入失败。你仍可直接在 Browser 中登录一次，登录态会长期保留。",
};
