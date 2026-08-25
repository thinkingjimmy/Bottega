---
name: section-handoff
displayName: Section 交接
description: 把当前成果交给已有或新建 Section，并明确上下文与验收标准。
requires: builtin-tools: mutate
---

# Section 交接

先总结当前结论、未决问题与可验证的验收标准，再选择一种方式：

- 已有目标：调用 `send_to_section({ section_id, message, expect_reply })`。需要目标回答自动回到当前 Section 时保留 `expect_reply: true`；纯通知设为 `false`。
- 新目标：调用 `create_section({ first_message, title?, agent?, context_section_ids? })`。结构化上下文必须放进 `context_section_ids`；只在 `first_message` 里写 `@标题` 不会注入上下文。

检查返回值：`send_to_section` 返回 `status`（`started | queued | paused | rejected`）；`create_section` 返回 `section_id` 与 `first_turn`（`started | paused | rejected`），后续投递必须使用返回的 `section_id`，不要预测或从标题推断。`paused` 表示预算或恢复闸门要求用户确认；不要自行绕过。无人值守目标若使用 `ask-for-approval`，链会等待用户处理审批。
