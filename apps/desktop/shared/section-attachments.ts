/**
 * [INPUT]: Depends on ChatAttachmentMeta, dataUrlByteSize and the frozen Section tail draft; Receive image capability, single Section number and full-round byte budget
 * [OUTPUT]: Provides unchanging SectionSnapshotPlan[] Width of attachment lines such as tri-mode rendering Neutral/ Planning Points/ Human-readable endnotes) with copy authentication assertions
 * [POS]: The only source of truth for sharing decisions is the shared Section image; Main Two ways of materialising are only consumption plans, not re-option
 */

import type { ChatAttachmentMeta } from "./chats-ipc";
import {
  SECTION_ATTACHMENT_COUNT_LIMIT,
  SECTION_ATTACHMENT_TOTAL_BYTE_LIMIT,
  dataUrlByteSize,
} from "./agent-ipc";

export type SectionAttachmentReason =
  | "included"
  | "image-input-off"
  | "count-limit"
  | "byte-limit"
  | "read-section-only"
  | "transcript-truncated";

/* ============================================================
 * 附件行有三种渲染态，各自的读者不同：
 *
 * "plain"   —— 与 plan 无关的中性投影。全局搜索用 messageLines 当 canonical
 *              语料，任何机器 token 落进去都会被当成 snippet 呈给用户。
 * "pending" —— 只在 planSectionSnapshots 规划期存在的内部锚点，永不出门。
 * 终态 reason —— 人类可读终稿，@Section 快照与 read_section 转录见到的就是它。
 *
 * 终态与 pending 必须等宽（UTF-8 字节），否则「先按 pending 定长跑完预算循环、
 * 再回填终稿」这条定序会被打破：附件决策会反过来改变 tail 幸存集。
 * ============================================================ */
export type SectionAttachmentRender = "plain" | "pending" | SectionAttachmentReason;

const STATUS_TEXT: Readonly<Record<
  Exclude<SectionAttachmentRender, "plain">,
  string
>> = {
  pending: "原件随附待定",
  included: "原件已随附",
  "image-input-off": "原件未随附（Agent 不支持图片）",
  "count-limit": "原件未随附（超出张数上限）",
  "byte-limit": "原件未随附（超出字节预算）",
  "read-section-only": "原件未随附（read_section 不随附）",
  "transcript-truncated": "原件未随附（转录已截断）",
};

/** 全部状态串补齐到的统一 UTF-8 字节宽；新增 reason 超宽即在模块初始化时炸掉。 */
export const SECTION_ATTACHMENT_STATUS_BYTE_WIDTH = 43;

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

const renderStatus = (status: Exclude<SectionAttachmentRender, "plain">) => {
  const text = STATUS_TEXT[status];
  return text.padEnd(
    text.length + SECTION_ATTACHMENT_STATUS_BYTE_WIDTH - utf8Length(text),
    " "
  );
};

for (const status of Object.keys(STATUS_TEXT) as (keyof typeof STATUS_TEXT)[]) {
  const width = utf8Length(STATUS_TEXT[status]);
  if (width > SECTION_ATTACHMENT_STATUS_BYTE_WIDTH) {
    throw new Error(
      `Section 附件状态「${status}」宽 ${width} 字节，超过 ${SECTION_ATTACHMENT_STATUS_BYTE_WIDTH}：等宽被打破会污染 tail 预算`
    );
  }
}

export function sectionAttachmentLine(
  meta: ChatAttachmentMeta,
  render: SectionAttachmentRender
) {
  if (render === "plain") {
    return `  [附件] ${meta.filename}（${meta.mediaType}，${meta.byteSize} 字节）`;
  }
  return `  [attachment id=${meta.id}] ${meta.filename} (${meta.mediaType}, ${meta.byteSize} bytes；${renderStatus(render)})`;
}

/**
 * 拷贝保真：字节数 + 媒体类型。大小写不敏感与入库侧 `chat-input.ts` 的
 * `toLowerCase` 比对同口径——否则「image/PNG」这种合法存量会被误判成
 * 「拷贝期间发生变化」而拒绝准入。
 */
export function assertCopyFidelity(meta: ChatAttachmentMeta, dataUrl: string) {
  const declared = /^data:([^;,]+);base64,/i.exec(dataUrl)?.[1];
  if (
    dataUrlByteSize(dataUrl) !== meta.byteSize ||
    declared?.toLowerCase() !== meta.mediaType.toLowerCase()
  ) {
    throw new Error(`Section 附件 ${meta.filename} 在拷贝期间发生变化`);
  }
}

export type SectionSnapshotDraft = Readonly<{
  sectionId: string;
  incarnationId: string;
  sourceAgent: string;
  /** 交割物完整性字段：快照捕获到的末 seq，消费者据此判断有无更新的历史。 */
  capturedSeq: number;
  includedFromSeq: number;
  /** 交割物完整性字段：本快照实际写入的末 seq。 */
  includedThroughSeq: number;
  transcript: string;
  attachments: readonly ChatAttachmentMeta[];
}>;

export type SectionSnapshotPlan = Readonly<{
  sectionId: string;
  incarnationId: string;
  sourceAgent: string;
  /** 交割物完整性字段：快照捕获到的末 seq，消费者据此判断有无更新的历史。 */
  capturedSeq: number;
  includedFromSeq: number;
  /** 交割物完整性字段：本快照实际写入的末 seq。 */
  includedThroughSeq: number;
  transcript: string;
  attachments: Readonly<{
    included: readonly ChatAttachmentMeta[];
    omitted: readonly Readonly<{
      meta: ChatAttachmentMeta;
      reason: Exclude<SectionAttachmentReason, "included">;
    }>[];
  }>;
  /** 交割物完整性字段：included 字节和，跨 Section 共享预算的扣减依据。 */
  bytesConsumed: number;
}>;

export function planSectionSnapshots(
  drafts: readonly SectionSnapshotDraft[],
  options: Readonly<{
    imageInput: boolean;
    perSectionCount?: number;
    totalBytes?: number;
  }>
): readonly SectionSnapshotPlan[] {
  const perSectionCount = options.perSectionCount ?? SECTION_ATTACHMENT_COUNT_LIMIT;
  let remaining = options.totalBytes ?? SECTION_ATTACHMENT_TOTAL_BYTE_LIMIT;
  return drafts.map((draft) => {
    const included: ChatAttachmentMeta[] = [];
    const omitted: Array<{
      meta: ChatAttachmentMeta;
      reason: Exclude<SectionAttachmentReason, "included">;
    }> = [];
    let transcript = draft.transcript;
    for (const meta of draft.attachments) {
      /* 超长单条消息被字节预算截断时，锚点可能整条不在转录里。此时静默跳过
         替换＝「图已发、转录没提」——先判在不在，不在就强制降级，附件也就
         不会白吃掉数量与字节预算。 */
      const anchor = sectionAttachmentLine(meta, "pending");
      const at = transcript.indexOf(anchor);
      const reason: SectionAttachmentReason =
        at < 0
          ? "transcript-truncated"
          : !options.imageInput
            ? "image-input-off"
            : included.length >= perSectionCount
              ? "count-limit"
              : meta.byteSize > remaining
                ? "byte-limit"
                : "included";
      if (at >= 0) {
        transcript =
          transcript.slice(0, at) +
          sectionAttachmentLine(meta, reason) +
          transcript.slice(at + anchor.length);
      }
      if (reason === "included") {
        included.push(meta);
        remaining -= meta.byteSize;
      } else {
        omitted.push({ meta, reason });
      }
    }
    return Object.freeze({
      sectionId: draft.sectionId,
      incarnationId: draft.incarnationId,
      sourceAgent: draft.sourceAgent,
      capturedSeq: draft.capturedSeq,
      includedFromSeq: draft.includedFromSeq,
      includedThroughSeq: draft.includedThroughSeq,
      transcript,
      attachments: Object.freeze({
        included: Object.freeze(included),
        omitted: Object.freeze(omitted),
      }),
      bytesConsumed: included.reduce((total, meta) => total + meta.byteSize, 0),
    });
  });
}
