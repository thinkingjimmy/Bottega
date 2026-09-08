/**
 * [INPUT]: Depends on no runtime modules
 * [OUTPUT]: Provides localized Agent selection, pending, eligibility, and retained-history disclosure
 * [POS]: Chat Agent switch locale leaf
 */

export const chatAgentSwitchZhCN = {
  "pending": "下一条消息将由 {{backend}} 回复，聊天记录保留",
  "undo": "撤销",
  "details": "接续信息",
  "explanation": "新 Agent 会接收历史节选，并在可用时补读仍保存的记录；历史图片内容和工具运行状态不会自动继承。",
  "permission": "权限：{{from}} → {{to}}",
  "confirming": "正在确认发送结果…",
  "recovering": "消息已提交，正在恢复…",
  "stale": "此聊天已发生变化，请重新选择目标 Agent。",
  "adjacent": "请先发送新消息或撤销 Agent 切换。",
  "defaultsFailed": "聊天配置已保存，但更新全局默认值失败。",
  "divider": "从此处开始由 {{backend}} 回复",
  "notInjected": "部分历史未直接携带，可尝试补读仍保存的记录。",
  "storageTrimmed": "部分较早记录已不再保存。",
  "lookupUnavailable": "当前无法补读未携带的历史。",
  "running": "回复结束后可切换。",
  "queue": "处理待发送消息后可切换。",
  "recovery": "完成恢复后可切换。",
  "readonly": "此聊天为只读，请先使用来源 Agent 接管。",
  "app-bound": "此 Agent 由 App 指定。",
  "archived": "已归档聊天不能切换 Agent。",
  "approval": "请先处理待批准请求。",
  "plan-review": "请先完成 Plan 审阅。",
  "paused": "请先恢复或结束已暂停的接续链。",
  "submission": "请先确认上一次发送结果。",
  "selectionFailed": "选择 Agent 失败：{{message}}",
  "revision-stale": "此聊天已发生变化，请重新选择目标 Agent。"
};
