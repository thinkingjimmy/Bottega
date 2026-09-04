/**
 * [INPUT]: Depends only on SQLite DDL supported by the packaged Electron runtime
 * [OUTPUT]: Provides migration 0002: drops the import entry completeness columns that only the deleted unsupported-block path could ever set
 * [POS]: The first forward step after the released 0001 schema; it changes no row, only the shape a row is allowed to have
 */

/* ── 完整性两列没有生产者了 ────────────────────────────────────
 * `content_complete=0` / `incomplete_reason` 只有一个来源：适配器把
 * 不认识的 JSONL 记录转义成 unsupported 块，规范化再把它落成一条
 * 「不完整的 assistant 正文」——那正是导入历史顶上那行 world_state
 * 原始 JSON。块没了，两列就永远是 1/NULL，一个恒真的列不是事实，
 * 是噪音。0001 已随 v0.1.0 发布，是不可变的；改变形状只能往前走。
 * 读侧从未查过这两列，因此这一步不动任何一行数据。
 * ────────────────────────────────────────────────────────── */
export const CHAT_STORE_SCHEMA_V2 = String.raw`
ALTER TABLE chat_import_entry_versions DROP COLUMN content_complete;
ALTER TABLE chat_import_entry_versions DROP COLUMN incomplete_reason;
`;
