---
name: section-review-loop
displayName: Section Review 回环
description: 将成果送交 reviewer Section，消费自动回信并迭代到无 P0/P1。
requires: builtin-tools: mutate
---

# Section Review 回环

1. 用 `list_sections` 找到 reviewer 的稳定 `section_id`。
2. 调用 `send_to_section`，`expect_reply: true`，要求 reviewer 只返回：
   - `APPROVED`；或
   - P0/P1 问题清单，每项包含证据、影响与可执行修复。
3. 产品会把 reviewer 的最终回答自动回递到当前 Section；reviewer 端无需 Skill，也不应手动回信。
4. 收到问题后完成修改与验证，再显式调用 `send_to_section` 发起下一轮。只有 LLM 的明确调用才能继续回环。
5. 收到 `APPROVED` 后停止。返回 `paused`、出现链暂停 notice 或审批挂起时立即停止并向用户说明。

自动接力有链级预算；不要创建新链规避上限。无人值守 reviewer 建议使用 `approve-for-me` 或 `full-access`，但不得静默修改用户权限。
