/**
 * [INPUT]: Depends on the shared ForeignHistoryMessage/ForeignProcessStep wire and the adapter turn-stream type
 * [OUTPUT]: Provides foldHistoryTurns/foldAssistantRun (one assistant entry per turn, each process step ordered tools-then-text because a block's tools are the calls that preceded it), splitPlan/flattenPlanTags (Codex `<proposed_plan>` machine tags) and stripProductContext (our own outgoing envelope)
 * [POS]: The single normalization seam every history adapter's turn stream passes through before batching; adapters stay format parsers and never learn turn shape
 */

import type {
  ForeignHistoryMessage,
  ForeignProcessStep,
  ForeignToolEvent,
} from "../../../shared/history-import-ipc";
import type { HistoryBlockTurns } from "./adapter";

/* ── Codex 计划标签：<proposed_plan> 是模型输出里的机器语法 ─────────
 * 产品正史里 plan 走 PlanCard；源文本把计划内嵌在 assistant 正文的标签里，
 * 按普通 markdown 渲染标签就裸奔。此处拆出计划正文交给同一张 PlanCard，
 * 前言沉进过程区（与原生 finalize 同律：计划是本轮权威产出，它前后的
 * 普通文本一律折叠）；未闭合（中断留痕）按开标签起始截到末尾。
 * 拆分不分来源——它是源文本里的一段机器语法，谁写下的都一样裸奔。
 * ────────────────────────────────────────────────────────── */
const PLAN_PATTERN = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/;
const OPEN_PLAN_PATTERN = /<proposed_plan>\s*([\s\S]*)$/;

export function splitPlan(content: string): { prose: string; plan: string | null } {
  const match = PLAN_PATTERN.exec(content) ?? OPEN_PLAN_PATTERN.exec(content);
  if (!match) return { prose: content, plan: null };
  const prose = `${content.slice(0, match.index)}\n\n${content.slice(
    match.index + match[0].length
  )}`.trim();
  return { prose, plan: match[1]!.trim() || null };
}

/** 过程流里的中间陈述不出卡片：剥标签后计划正文以纯文本并入，防裸奔。 */
export function flattenPlanTags(content: string): string {
  const { prose, plan } = splitPlan(content);
  return [prose, plan].filter(Boolean).join("\n\n");
}

/* ── 我们自己的信封不该回流成用户的第一句话 ─────────────────────
 * 产品把 <product_context …> 作为**独立的一块** text content block 拼在
 * prompt 前面（backends/acp/turn/setup.ts）。源侧把一条消息的所有 text
 * 块拼成一段正文，于是导入回来时这段信封成了第一个用户气泡，还顺手当上
 * 了侧栏标题。信封是产品说的话，不是用户说的话：剥掉它，保留用户自己
 * 写下的那部分；剥完什么都不剩，这条消息本就不该存在。
 * ────────────────────────────────────────────────────────── */
const PRODUCT_CONTEXT_PATTERN = /<product_context\b[^>]*>[\s\S]*?<\/product_context>/g;
/** 未闭合只可能是信封被截断——它恒在最前，其后无一字属于用户。 */
const OPEN_PRODUCT_CONTEXT_PATTERN = /^\s*<product_context\b[\s\S]*$/;

export function stripProductContext(value: string): string {
  if (!value.includes("<product_context")) return value;
  const closed = value.replace(PRODUCT_CONTEXT_PATTERN, "");
  return (OPEN_PRODUCT_CONTEXT_PATTERN.test(closed) ? "" : closed).trim();
}

/* 一条 assistant 消息挂着的工具，是**跑在它之前**的那些调用（codex 在推入
   assistant 块时 drainTools，claude 的 tool_use 与该分片同属一条记录）。
   投影因此是「工具在前、陈述在后」——JSON 时代 groupTurns 就是这么排的。 */
const step = (
  text: string,
  tools?: readonly ForeignToolEvent[]
): ForeignProcessStep => ({
  text,
  ...(tools?.length ? { tools: [...tools] } : {}),
});

/**
 * 一轮里的全部 assistant 消息折成一条：末条是正文，其余按源序编成 process
 * （每一步是「它之前那些工具 + 它的陈述」）。末条正文若内嵌计划标签，计划
 * 正文升为 content、前言沉入 process 末位——读侧因此只需「逐 process 摊开，
 * 再接末条工具」一条直路，没有第二种形状。
 */
export function foldAssistantRun(
  messages: readonly ForeignHistoryMessage[]
): ForeignHistoryMessage {
  const final = messages.at(-1)!;
  const process: ForeignProcessStep[] = [];
  for (const message of messages.slice(0, -1)) {
    const text = flattenPlanTags(message.content).trim();
    if (!text && !message.tools?.length) continue;
    process.push(step(text, message.tools));
  }
  const { prose, plan } = splitPlan(final.content);
  /* 前言沉进过程流时，末条那些工具必须跟着一起沉：它们跑在前言之前，留在
     entry 上就会被投影到前言之后，时序当场倒挂。 */
  const sunk = Boolean(plan && prose);
  if (sunk) process.push(step(prose, final.tools));
  if (!process.length && !plan) return final;
  const { tools: _sunkTools, ...withoutTools } = final;
  return {
    ...(sunk ? withoutTools : final),
    content: plan ?? final.content,
    ...(process.length ? { process } : {}),
    ...(plan ? { plan: true as const } : {}),
  };
}

/**
 * user 边界之间的 assistant 全部归一条。适配器只管把源解析成消息，
 * 「一 turn 长什么样」这件事在这里裁决一次——四家来源因此不必各写一遍，
 * 也不会各写歪一遍。折叠必须在规范化之前完成：entry 一旦落盘即不可变。
 */
export async function* foldHistoryTurns(
  source: HistoryBlockTurns,
  signal?: AbortSignal
): HistoryBlockTurns {
  let pending: ForeignHistoryMessage[] = [];
  let ready: ForeignHistoryMessage[] = [];
  const closeRun = () => {
    if (!pending.length) return;
    ready.push(foldAssistantRun(pending));
    pending = [];
  };
  while (true) {
    signal?.throwIfAborted();
    const next = await source.next();
    if (next.done) {
      closeRun();
      if (ready.length) yield ready;
      return next.value;
    }
    for (const block of next.value) {
      if (block.role === "user") {
        closeRun();
        ready.push(block);
      } else {
        pending.push(block);
      }
    }
    if (ready.length) {
      yield ready;
      ready = [];
    }
  }
}
