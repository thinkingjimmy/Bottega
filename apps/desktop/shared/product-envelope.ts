/**
 * [INPUT]: Depends on nothing — pure tag truth, importable from main, preload and renderer alike
 * [OUTPUT]: Provides PRODUCT_ENVELOPE_TAGS/ProductEnvelopeTag plus openEnvelope/closeEnvelope tag builders
 * [POS]: The single source of truth for the product's outgoing prompt envelopes; agent/product-context.ts and memory/prompt-lane.ts compose with it, history-import/turn-folding.ts builds its strip patterns from it
 */

/* ── 信封标签：产品替用户说话的那几块，名字只能有一处 ──────────────
 * 产品在 prompt 之前拼进去的每一块 XML 信封（能力说明、长期记忆），
 * 导入外部历史时都必须被剥掉——那是产品说的话，不是用户说的话。
 * 标签名若在拼装侧与剥离侧各写一份，新增一种信封时剥离侧必然漏掉它：
 * memory_context 就是这么变成用户第一句话的。两侧共用同一份标签表，
 * 拼装者与剥离者不可能再各知道一半。
 * ────────────────────────────────────────────────────────── */
export const PRODUCT_ENVELOPE_TAGS = Object.freeze([
  "product_context",
  "memory_context",
] as const);

export type ProductEnvelopeTag = (typeof PRODUCT_ENVELOPE_TAGS)[number];

/** `<tag …attrs>`：属性由各拼装者自负，标签名只此一处。 */
export function openEnvelope(tag: ProductEnvelopeTag, attributes = "") {
  return `<${tag}${attributes ? ` ${attributes}` : ""}>`;
}

export function closeEnvelope(tag: ProductEnvelopeTag) {
  return `</${tag}>`;
}
