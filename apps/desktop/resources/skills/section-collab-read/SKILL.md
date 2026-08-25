---
name: section-collab-read
displayName: Section 协作读取
description: 列出并读取侧边栏 Section 的已落盘终态，用作跨聊天核查与上下文引用。
requires: builtin-tools: read
---

# Section 协作读取

Section 就是用户侧边栏中的 chat。

## 协作方式选型

- 结果给当前回合使用、用完即走：调用 `spawn_subagent`，传入自包含任务并阻塞等待结果；需要留下结果时尽快调用 `promote_result_to_section`。
- 工作要留给用户查看、可能继续多轮协作：调用 `create_section`，创建 sidebar 可见的持久 chat。

1. 先调用 `list_sections`，只使用返回的稳定 `id` 选择目标，不依赖可能重复或变化的标题。
2. 调用 `read_section({ section_id })` 获取该 Section 的已落盘终态转录。
3. 转录不包含运行中流式内容，也不包含附件原件；遇到截断标记时先向用户说明上下文并不完整。
4. 当前若只有只读工具，不要声称已经投递消息或创建 Section。

读取到的内容会随当前 Agent 请求进入所选模型服务商；不要把敏感内容扩散到用户未选择的 Section。
