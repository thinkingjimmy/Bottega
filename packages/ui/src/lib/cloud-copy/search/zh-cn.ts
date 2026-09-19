/**
 * [INPUT]: Fixed seven-day client search and measured incomplete-cache states.
 * [OUTPUT]: Shared localized command groups, search, coverage and refresh-protection copy.
 * [POS]: Cloud copy catalog; index progress never implies that chat drafts are saved.
 */
import type { CloudSearchCopy } from "./en";
export const zhCN: CloudSearchCopy = {
  "results": "搜索结果",
  "actions": "快捷操作",
  "label": "搜索聊天",
  "placeholder": "输入搜索词",
  "scope": "搜索聊天标题及最近 7 天的消息。",
  "preparing": "正在准备最近 7 天的搜索，当前结果可能不完整。",
  "updating": "正在更新搜索，当前结果可能不完整。",
  "ready": "搜索已准备就绪。",
  "limited": "搜索覆盖不足：部分内容缺少有效时间，或超出当前资源上限。",
  "paused": "搜索已暂停。请联网后重试更新。",
  "storageFailed": "加密搜索缓存未能保存。本页仍可搜索，刷新后可能需要重建。",
  "unsaved": "搜索正在准备中，刷新可能需要重新处理尚未保存的进度。",
  "progress": "已索引 {titles} 个标题 · {messages} 条消息",
  "searching": "正在搜索…",
  "empty": "没有找到匹配内容。",
  "emptyPartial": "已准备的内容中没有匹配结果，搜索覆盖仍不完整。",
  "resultsLimited": "当前显示前 100 个结果。可增加搜索词缩小范围。",
  "stale": "此结果已变化或无法访问，请重新搜索。",
  "retry": "重试准备搜索",
  "untitled": "未命名聊天",
  "titleHit": "聊天标题",
  "messageHit": "消息",
  "queryInvalid": "请使用不超过 256 个字符、16 个词的搜索内容。"
};
