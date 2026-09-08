/**
 * [INPUT]: Depends on interpolation facts from main-owned App compatibility and update contracts.
 * [OUTPUT]: Provides localized minimum-host installation and updater guidance.
 * [POS]: App host-version locale leaf, assembled by its matching top-level catalog.
 */

export const appHostZhCN = {
  "title": "请先升级 Bottega",
  "invalidTitle": "App 发布信息需要检查",
  "APP_HOST_UPDATE_REQUIRED": "安装 {{name}} 需要 Bottega {{minimum}} 或更高版本，你当前使用的是 {{current}}。",
  "APP_COMPATIBILITY_MISSING": "此 App 缺少必需的发布信息，请重新检查或联系作者。",
  "APP_COMPATIBILITY_INVALID": "此 App 的发布信息无效，请重新检查或联系作者。",
  "APP_COMPATIBILITY_SCHEMA_UNSUPPORTED": "当前 Bottega 无法识别此版本的 App 发布信息。",
  "APP_HOST_VERSION_UNAVAILABLE": "无法可靠取得当前运行的 Bottega 版本，请重新检查。",
  "oldVersionUsable": "当前已安装版本仍可使用。",
  "upgrade": "去升级 Bottega",
  "cancel": "暂不安装",
  "recheck": "重新检查",
  "waitingLabel": "需要升级 Bottega",
  "resume": "继续安装",
  "requiredContext": "{{name}} 需要 Bottega {{minimum}}，当前运行版本为 {{current}}。",
  "waitingDownload": "当前下载结束后将检查所需版本。",
  "checking": "正在检查满足要求的 Bottega 版本…",
  "unavailable": "本次检查未找到满足此 App 要求的 Bottega 发布版本。",
  "installBusy": "正在准备安装，暂时无法更换版本。",
  "retryError": "更新未完成，可以重新检查并重试。",
  "returnToApp": "返回 App",
  "dismiss": "关闭升级引导",
  "candidateUnavailable": "原 App 候选已无法获取或不再被允许，请检查并重新确认新候选。",
  "checkLatest": "检查最新候选"
};
