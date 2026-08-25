/**
 * [INPUT]: Depends on the Agent domain with clearly truncated facts PromotableResultSource narrow ports, ConversationCoordinator seed admission, current lease provenance and UTF-8 interceptor
 * [OUTPUT]: Provides promoteSubagentResult; The Number of bits is set by the "N-rendered must have N bits" (footer budget stashes to each piece), the first bits are perpetuated by D-D6 provenance, the last bits are given read_Section restored input, the restored bits are projected by admission and the book provenance is upgraded to idle section by default with the Subagent name
 * [POS]: The cross-domain authorization adapter for sections; Consuming narrow read ports only, not relying on Subagent SpawnService implementation
 */

import type { PromotableResultSource } from "../agent/subagent-spawn";
import type { BuiltinToolContext } from "../tools/registry";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type { PersistedSubagentStatus } from "../../../shared/chats-ipc";
import { truncateUtf8 } from "../../../shared/truncate-utf8";

const PROMOTED_MESSAGE_BYTE_LIMIT = 32 * 1024;
const CHUNK_LIMIT = 16;

export type PromoteProvenance = {
  agentThreadId: string;
  sourceChatId: string;
  sourceIncarnationId: string;
  subagentAgent: AgentBackendId;
  subagentStatus: PersistedSubagentStatus;
  /** 源结果的字节数（`truncated` 为真时，落进 Section 的少于它）。 */
  byteSize: number;
  truncated: boolean;
};

export type PromoteAdmissionPort = {
  promoteResult(
    input: {
      agentThreadId: string;
      messages: string[];
      title?: string;
      agent?: string;
      inheritProject?: boolean;
      note?: string;
      promotedFrom: PromoteProvenance;
    },
    context: BuiltinToolContext
  ): Promise<{
    section_id: string;
    first_turn: "idle" | "rejected";
    detail?: string;
    /* 账本里那条 intent 的 provenance。回执整条由它投影——replay 命中时
       section_id 来自上次入账，字节账若取本次取材，两者说的就是两件事。 */
    promotedFrom: PromoteProvenance;
  }>;
};

export async function promoteSubagentResult(
  args: {
    agent_thread_id: string;
    title?: string;
    agent?: string;
    inherit_project?: boolean;
    note?: string;
  },
  context: BuiltinToolContext,
  source: PromotableResultSource,
  coordinator: PromoteAdmissionPort
) {
  const material = source.peekResult(args.agent_thread_id, context);
  if (!material?.text) {
    throw Object.assign(
      new Error("Subagent 结果不存在、已逐出，或不属于当前回合"),
      { status: 404 }
    );
  }
  const render = (truncated: boolean) => renderMessages({
    agentThreadId: args.agent_thread_id,
    byteSize: material.resultBytes,
    note: args.note,
    sourceChatId: context.lease.chatId,
    sourceIncarnationId: context.lease.incarnationId,
    subagentAgent: material.agent,
    subagentStatus: material.status,
    text: material.text,
    truncated,
  });
  /* 分片装不下即为截断事实；重渲一次让首片头如实自述。 */
  const first = render(material.truncated);
  const truncated = material.truncated || !first.complete;
  const rendered = truncated === material.truncated ? first : render(truncated);
  const result = await coordinator.promoteResult(
    {
      agentThreadId: args.agent_thread_id,
      messages: rendered.messages,
      title: truncateUtf8(args.title?.trim() || material.name, 200).value,
      ...(args.agent ? { agent: args.agent } : {}),
      inheritProject: args.inherit_project ?? false,
      ...(args.note !== undefined ? { note: args.note } : {}),
      promotedFrom: {
        agentThreadId: args.agent_thread_id,
        sourceChatId: context.lease.chatId,
        sourceIncarnationId: context.lease.incarnationId,
        subagentAgent: material.agent,
        subagentStatus: material.status,
        byteSize: material.resultBytes,
        truncated,
      },
    },
    context
  );
  /* 回执三个字段同出一条账本记录：`promoted_bytes` 与首片头上的
     `byte_size` 是同一个数（源结果字节数），`truncated` 为真即落进
     Section 的少于它——两者必须一起读，分开读会以为拿到了全文。 */
  return {
    section_id: result.section_id,
    promoted_bytes: result.promotedFrom.byteSize,
    truncated: result.promotedFrom.truncated,
    first_turn: result.first_turn,
    ...(result.detail ? { detail: result.detail } : {}),
  };
}

type RenderInput = Omit<PromoteProvenance, "truncated"> & {
  note?: string;
  text: string;
  truncated: boolean;
};

/* ── 片数是一个不动点，不是一次搜索 ──────────────────────────────────
 * 头部写着 `part: k/N`，正文预算又扣着头尾——N 于是既是输入也是输出。
 * 早先的写法从 N=1 往上试「切完且恰好 N 片」，可 footer 只挂末片：N 大
 * 一档时末片的 footer 就搬走了，同一段文本反而少切一片，等式永远两边错
 * 位（实测 65171–65272 这 102 个字节尺寸——正好一条 footer 的体量——全部
 * 落空，最后以 `part: 1/16` 谎报片数、末片还丢了 read_section 提示行）。
 *
 * 把 footer 预算摊到每一片，「谁是末片」就不再影响任何一片的预算：片数
 * 只剩「N 有几位数」这一个自变量，而位数越少预算越宽、片数只会更少。于
 * 是从最紧的 CHUNK_LIMIT 出发迭代必然单调下降到不动点，两三次即收敛，
 * 末片那约 90 字节的预留由 footer 原样占用，不浪费也不越界。
 * ────────────────────────────────────────────────────────────────── */
function renderMessages(input: RenderInput) {
  let total = CHUNK_LIMIT;
  for (;;) {
    const split = splitBodies(input, total);
    const settled = Math.max(1, split.bodies.length);
    if (settled === total) {
      return {
        complete: split.complete,
        messages: split.bodies.map((body, index) =>
          `${promotionHeader(input, index, total)}${body}${
            index === total - 1 ? promotionFooter(total) : ""
          }`
        ),
      };
    }
    total = settled;
  }
}

/** 按「共 total 片」的头尾预算切正文；最多 CHUNK_LIMIT 片，切不完即截断。 */
function splitBodies(input: RenderInput, total: number) {
  const bodies: string[] = [];
  let rest = input.text;
  for (let index = 0; index < CHUNK_LIMIT && rest; index += 1) {
    const bodyBudget = PROMOTED_MESSAGE_BYTE_LIMIT
      - Buffer.byteLength(promotionHeader(input, index, total), "utf8")
      - Buffer.byteLength(promotionFooter(total), "utf8");
    if (bodyBudget <= 0) {
      throw Object.assign(new Error("promote provenance 头超过消息预算"), {
        status: 413,
      });
    }
    const body = truncateUtf8(rest, bodyBudget).value;
    if (!body) break;
    bodies.push(body);
    rest = rest.slice(body.length);
  }
  return { bodies, complete: rest.length === 0 };
}

function promotionHeader(input: RenderInput, index: number, total: number) {
  if (index > 0) {
    return [
      `[promoted ${index + 1}/${total}]`,
      `agent_thread_id: ${input.agentThreadId}`,
      "",
      "",
    ].join("\n");
  }
  return [
    "[Subagent result promotion]",
    `agent_thread_id: ${input.agentThreadId}`,
    `source_chat_id: ${input.sourceChatId}`,
    `source_incarnation_id: ${input.sourceIncarnationId}`,
    `subagent_agent: ${input.subagentAgent}`,
    `subagent_status: ${input.subagentStatus}`,
    `byte_size: ${input.byteSize}`,
    `part: 1/${total}`,
    `truncated: ${input.truncated}`,
    ...(input.note !== undefined ? [`note: ${JSON.stringify(input.note)}`] : []),
    "",
    "",
  ].join("\n");
}

function promotionFooter(total: number) {
  return total > 1
    ? `\n\n[Recovery] 全文共 ${total} 片；续聊上下文有限，完整内容请用 read_section 分页读取。`
    : "";
}
