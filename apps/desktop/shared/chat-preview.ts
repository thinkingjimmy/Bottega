/**
 * [INPUT]: Depends on shared/markdown-fences scanFences is compatible with ChatMessage for chats-ipc
 * [OUTPUT]: Provides CHAT_PREVIEW_LIMIT with previewOfMessages, refining a whole transcript into a second-line essay on the sidebar
 * [POS]: The only source of truth in the meaning of shared chat previews; The main is evaporated in metadataOf, and the browser degradation of the renderer is the same, with neither side recognizing Electron or perpetuation
 */

import type { ChatMessage } from "./chats-ipc";
import { scanFences } from "./markdown-fences";

/* ── 提炼，而不是截断 ──────────────────────────────────────────
 * 聊天软件敢把最后一条原样放进第二行，是因为人说的话本来就是一行。
 * Agent 不是：它的收尾常常是围栏代码、表格、清单。原样截三十个字符，
 * 交出来的是 "```bash" 或 "| 文件 | 改动 |"——那比空着更糟，因为它
 * 看上去像信息。所以这里先把结构整块丢掉，只留还读得出意思的散文。
 *
 * 提炼不出散文就交出 null。宁可这一行不存在，也不能让它说胡话——
 * 一个偶尔胡说的位置，会让人此后再也不敢信它，那等于整列全废。
 *
 * 围栏识别借 scanFences 而不是自写正则：CommonMark 的围栏规则有
 * ``` 与 ~~~ 两族、有长度递增的闭合、有引用/列表容器前缀、有流式
 * 中断留下的未闭合尾巴。那套语义本仓已有唯一真相源，这里再写一版
 * 只会得到一个「大部分时候对」的第二真相。
 * ────────────────────────────────────────────────────────── */

/** 行首结构标记：标题、引用、无序/有序列表。 */
const LINE_MARKER = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,3}[.)]\s+)/;
/** 代码与删除线：这两族符号在散文里没有字面用途，一律削平。 */
const CODE_MARKER = /[`~]+/g;
/** 强调星号：`2 * 3` 这类字面用法罕见，削平的代价远小于留着一屏星号。 */
const EMPHASIS_STAR = /\*+/g;
/* ── 下划线不能一律削平 ────────────────────────────────────────
 * CommonMark 明说词内下划线不构成强调，而 agent 的回复里 `chat_id`、
 * `base_migrations` 这类标识符满地都是。一律削平交出来的是
 * 「改用 chatid 而不是 chatId」——句子还通顺，说的却已经不是他的话了。
 * 悄悄改写内容比不显示更贵：它连「这里出问题了」的信号都不给。
 *
 * 判据只认 ASCII 字母数字。CJK 没有词间空格，`**必须**先` 的收尾恰好
 * 两侧都是汉字，用「两侧是字就保留」那条通则会把强调标记也留下来。
 * ────────────────────────────────────────────────────────── */
const UNDERSCORE_RUN = /_+/g;
const ASCII_WORD = /[A-Za-z0-9]/;
/** 整行结构：表格行与分隔线，削完只剩标点，留着也读不出意思。 */
const STRUCTURAL_LINE = /^(?:\||[-*_=+:\s]+$)/;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

/** IPC 上限；渲染端还会按宽度再截一次，这里只防止把整篇回复搬过去。 */
export const CHAT_PREVIEW_LIMIT = 160;

const withoutFences = (markdown: string) => {
  const fences = scanFences(markdown);
  if (fences.length === 0) return markdown;
  let text = "";
  let cursor = 0;
  for (const fence of fences) {
    text += `${markdown.slice(cursor, fence.start)} `;
    cursor = fence.end;
  }
  return text + markdown.slice(cursor);
};

/** 索引须取自被替换的那一份文本，故不能与其它 replace 并进同一条链。 */
const withoutIntraWordSafeUnderscores = (text: string) =>
  text.replace(UNDERSCORE_RUN, (run: string, index: number) =>
    ASCII_WORD.test(text[index - 1] ?? "") &&
    ASCII_WORD.test(text[index + run.length] ?? "")
      ? run
      : ""
  );

const withoutInlineMarkers = (line: string) =>
  withoutIntraWordSafeUnderscores(line.replace(CODE_MARKER, "")).replace(
    EMPHASIS_STAR,
    ""
  );

const distill = (content: string): string | null => {
  const prose = withoutFences(content)
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .split("\n")
    .map((line) => withoutInlineMarkers(line.replace(LINE_MARKER, "")).trim())
    .filter((line) => line.length > 0 && !STRUCTURAL_LINE.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // 按码位切，别把一个 emoji 劈成两半
  return prose ? [...prose].slice(0, CHAT_PREVIEW_LIMIT).join("") : null;
};

/**
 * 取最后一条人类可读的发言。notice 是产品自己说的话（迁移提示、限流告知），
 * 它回答不了「这场对话进行到哪了」，跳过去找它前面那条。
 */
export function previewOfMessages(
  messages: readonly ChatMessage[]
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    return distill(message.content);
  }
  return null;
}
