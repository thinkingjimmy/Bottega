/**
 * [INPUT]: Depends on the shared availability state vocabulary.
 * [OUTPUT]: Provides localized Agent availability and recovery copy.
 * [POS]: Availability locale leaf.
 */
export const agentAvailabilityZhCN = {
  "state": {
    "recent-sign-in": "最近请求需登录",
    "connection": "连接异常",
    "service": "服务异常",

    "ready": "已就绪",
    "custom-route": "自定义端点 · 登录未验证",
    "unverified": "待验证",
    "checking": "检查中",
    "missing": "未安装",
    "unsupported": "有可用更新",
    "sign-in": "未登录",
    "cannot-check": "无法检查",
    "cannot-start": "无法启动",
    "usage-limit": "已达用量限制",
    "unavailable": "不可用"
  },
  "unavailableReason": {
    "package-disabled": "已在插件中关闭",
    "package-removed": "已从这台电脑移除",
    "package-refused": "无法加载",
    "trust-refused": "在这台电脑上不受信任"
  },
  "imagesPreserved": "此 Agent 无法发送这些图片，附件已保留。",
  "managementUnavailable": "请打开主窗口管理 Agent。",
  "openMenu": "打开 Agent 菜单",
  "manage": "管理 Agent",
  "login": "登录",
  "retry": "重试",
  "locked": "当前 Chat 暂不可切换 Agent。",
  "blocked": "{{backend}} 当前不可用，草稿已保留。",
  "retrySending": "重试发送",
  "retryExplanation": "已登录或认为检查有误时，可直接尝试发送这条消息。",
  "customRoute": "{{backend}} 会把请求发到你配置的端点。Bottega 无法确认那里的登录是否有效；请求失败时会说明原因。",
  "isolatedConfig": "Bottega 用自己的配置运行 {{backend}}，你在 ~/.config/opencode 或项目 opencode.json 中设置的提供方在这里不会生效。",
  "unverifiedReason": {
    "provider-scoped": "{{backend}} 按项目检查登录，会在 Chat 运行时确认。",
    "not-supported": "{{backend}} 无法向 Bottega 报告登录状态；如果需要登录，Chat 里会提示。"
  }
};
