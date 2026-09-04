/**
 * [INPUT]: Depends on the English Agent failure catalog shape
 * [OUTPUT]: Provides Simplified Chinese Agent failure presentation copy
 * [POS]: Simplified Chinese leaf for provider-neutral Agent failures
 */

import { agentFailureEn } from "./en";

export const agentFailureZhCN: typeof agentFailureEn = {
  technicalDetails: "技术详情",
  copyDetails: "复制技术详情",
  copiedDetails: "已复制技术详情",
  code: {
    "auth-required": {
      title: "{{backend}} 需要重新登录",
      explanation: "登录状态已失效，或登录尚未完成。",
      resolution: "请在终端运行 `{{command}}`，完成登录后回到 Bottega 再试一次。",
    },
    "rate-limited": {
      title: "{{backend}} 当前请求过多",
      explanation: "服务商暂时降低了新请求的处理速度。",
      resolution: "请稍等片刻再试；如果持续出现，请检查网络和服务商状态页。",
    },
    "quota-exhausted": {
      title: "{{backend}} 当前没有可用额度",
      explanation: "账号已达到用量上限，或余额不足。",
      resolution: "请检查服务商套餐、用量和账单，或等待页面显示的恢复时间后再试。",
    },
    "context-exhausted": {
      title: "当前对话内容过多，无法继续",
      explanation: "Agent 已达到本对话的上下文或会话预算。",
      resolution: "请新建 Chat，并减少单次发送的文字、文件和粘贴内容。",
    },
    "connection-lost": {
      title: "与 {{backend}} 的连接已中断",
      explanation: "Bottega 未能与 Agent 保持稳定连接。",
      resolution: "请检查网络、VPN 和代理，连接稳定后再试一次。",
    },
    "request-rejected": {
      title: "{{backend}} 无法处理这个请求",
      explanation: "当前模型、配置或请求内容未被接受。",
      resolution: "请选择可用模型，检查 Agent 设置，并尝试更短、更简单的请求。",
    },
    "service-unavailable": {
      title: "{{backend}} 暂时不可用",
      explanation: "Agent 或模型服务商出现了临时故障。",
      resolution: "请稍后重试；如果持续出现，请更新 Agent，并复制技术详情用于排查。",
    },
    "runtime-unavailable": {
      title: "{{backend}} 无法启动",
      explanation: "本机 Agent 未安装、版本过低，或未通过启动检测。",
      resolution: "请打开 Agent 设置，安装或更新 {{backend}}，然后重新检测。",
    },
    unknown: {
      title: "{{backend}} 未能完成这个请求",
      explanation: "Agent 报告了一个 Bottega 暂时无法安全分类的问题。",
      resolution: "请再试一次；如果仍然出现，请展开并复制技术详情用于排查。",
    },
  },
  notice: {
    title: "{{backend}} 发出了一条提示",
    explanation: "这条提示来自 {{backend}} 自身，不是 Bottega 的问题，本轮回复不受影响。",
  },
};
