---
name: base-ops
displayName: Base 数据操作
description: 在当前 chat 可写的自有或 Project 共享 Base 中设计列、管理视图（含 Chart dashboard）、用 read_base 分页查询、采集记账，并导出 CSV artifact。
requires: tools: bases:mutate
---

# Base 数据操作

Base 工具作用域已由当前 chat 的 lease 固定：优先使用 chat 自有 Base；没有自有 Base 时，自动落到所属 Project 的共享 Base。写工具不接受 `chatId`/`projectId`/`baseId`；操作本轮附加 App 的 Base 时显式传 `target:"app:<id>"`（仅读与行级写，列/视图变更会 403）。

## 数据协议

1. 先 `base_describe`：读 `revision`、列 schema、视图与行数。
2. 缺列用 `base_add_columns`（带 `expected_revision`）；改名/删列用 `base_update_columns`（删列会连带清理行值与视图引用，需用户确认再动）。不能改列类型。
3. 采集/记账为每行生成稳定 `id` 再 `base_insert_rows`：同 id 同内容幂等成功，同 id 异内容 409。
4. 改数据用 `base_patch_rows`（字段级 LWW，`null` 清空，单批 ≤100 行）；删行用 `base_delete_rows`（不存在即 no-op）。
5. meta 变更遇 409 必须重新 describe 后重放，不要盲重试。
6. 查询用 `read_base`：省略 `section_id` 与 `target` 即读当前 chat 可写的 Base（尚未建表返回 404，读不建表），每页 100 行、携带 `nextCursor` 直到缺失；**同一分页期间 Base revision 变化会得到 409「请重新读取」，必须弃掉旧 cursor 从头再来**。跨 Section 读别的 Base 用 `search_bases` 定位后给 `read_base` 传 `section_id`；读本轮附加 App 的 Base 传 `target`。
7. 全量导出用 `base_export_csv`，返回 `{path,bytes,rowCount}` artifact 元数据。

## 视图协议

- `base_set_view` 创建/替换命名视图，`set_active:true` 可原子切换。固定六类：`table`、`list`、`kanban`、`map`、`chart`、`gallery`；不存在 GUI/embed View。
- Gallery 必须传 `attachmentColumnId`（attachment 列），可传 `titleColumnId`、`groupByDateColumnId`（date 列）和 `dateBucket:minute|hour|day|week|month`，并与其它 View 一样支持 `filter`/`sorts`。GUI 是 Base App 独立“应用” Surface，不通过 `base_set_view` 创建。
- **用户要「在 Base 里持续看图表」时建 chart 视图**：`charts` 数组 ≤12 图，每图 `chartType` ∈ pie/bar/line/stacked-bar/scatter/radar/heatmap，配 `dimensionColumnId`（维度）、`valueColumnIds`（≤3 值列）、`aggregation`（sum/avg/…）、日期列可 `dateBucket: day|month`，`colSpan` 1–4 / `rowSpan` 1–2 排版；单卡 `accessibleColors:true` 可用纹理辅助区分系列，缺省为 false。
- 一次性、只在本条回复里看的图用正文 ```chart 围栏（见 chart-render skill），不要为此建视图。

## 示例

记账场景建 `date`（date）、`amount`（number）、`category`（select）、`note`（text）四列；月度支出 dashboard = `base_set_view` 传 `type:"chart"`，一张 pie（category 维度 sum amount）+ 一张 line（date 按 month 分桶 sum amount）。
