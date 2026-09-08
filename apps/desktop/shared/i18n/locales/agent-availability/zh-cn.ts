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
    "unverified": "待验证",
    "checking": "检查中",
    "missing": "未安装",
    "unsupported": "需更新",
    "sign-in": "需登录",
    "cannot-check": "无法检查",
    "cannot-start": "无法启动",
    "usage-limit": "已达用量限制"
  },
  "imagesPreserved": "此 Agent 无法发送这些图片，附件已保留。",
  "managementUnavailable": "请打开主窗口管理 Agent。",
  "openMenu": "打开 Agent 菜单",
  "manage": "管理 Agent",
  "login": "登录",
  "install": "安装",
  "update": "更新",
  "retry": "重试",
  "locked": "当前 Chat 暂不可切换 Agent。",
  "blocked": "{{backend}} 当前不可用，草稿已保留。",
  "retrySending": "重试发送",
  "retryExplanation": "已登录或认为检查有误时，可直接尝试发送这条消息。"
};
