/**
 * [INPUT]: Depends on the settingsBrowserEn structural type
 * [OUTPUT]: Provides settingsBrowserZhCN, the Simplified Chinese Settings › Browser catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/settings/browser; loaded on demand by the matching top-level locale
 */

import type { settingsBrowserEn } from "./en";

export const settingsBrowserZhCN: typeof settingsBrowserEn = {
  detecting: "正在检测 Chrome…",
  noProfiles: "未发现 Google Chrome 或可用 profile。",
  detectFailed: "无法检测 Chrome profiles。",
  platformUnavailable: "当前预览版本尚不支持 Chrome 登录态导入。",
  guideTitle: "在 Bottega 使用你的 Chrome 登录态",
  guideDescription:
    "导入所选站点的登录态，让 Agent 以你的身份浏览。导入前可选择 profile 与站点。",
  guideAction: "从 Chrome 导入…",
  facts: {
    readOnlyTitle: "只读",
    readOnlyDetail: "不会修改 Chrome。",
    localTitle: "留在本机",
    localDetail: "Cookie 不会上传。",
    keychainTitle: "Keychain 访问",
    keychainDetail: "macOS 仅询问一次；拒绝不影响 Chrome。",
  },
  lastImport: "上次导入",
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
