/**
 * [INPUT]: The App GUI entry states of TASK-22 (approved copy, 2026-09-27) with {{app}} and {{computer}} placeholders.
 * [OUTPUT]: Simplified Chinese App GUI entry copy.
 * [POS]: Cloud copy catalog for the App GUI entry (TASK-21 artboard 11); the state keys match Cloud Web's SurfaceStatus.
 */
import type { CloudSurfaceCopy } from "./en";
export const zhCN: CloudSurfaceCopy = {
  "open": "打开 App",
  "appsDescription": "打开已同步的 App，或查看和编辑其记录。",
  "yourComputer": "你的电脑",
  "loading": "正在打开 {{app}}…",
  "updated": "{{app}} 已更新到最新版本。",
  "expiredTitle": "页面已超时",
  "expiredBody": "{{app}} 闲置了一段时间，重新加载即可继续。",
  "reload": "重新加载",
  "staleTitle": "有新版本",
  "staleBody": "{{app}} 已在 {{computer}} 上更新，重新加载即可使用。",
  "missingTitle": "{{app}} 还没同步完",
  "missingBody": "来自 {{computer}} 的部分文件还没到，稍后再试。",
  "tryAgain": "重试",
  "unsupportedTitle": "请在电脑上打开 {{app}}",
  "unsupportedBody": "这个 App 使用旧格式，无法在网页上运行。",
  "offlineTitle": "{{computer}} 已离线",
  "offlineBody": "{{computer}} 上线并同步后，这里就能使用 {{app}}。",
  "revokedTitle": "{{app}} 已不可用",
  "revokedBody": "它已被删除，或当前账号已无权访问。",
  "failedTitle": "{{app}} 打不开",
  "failedBody": "加载时出了问题。"
};
