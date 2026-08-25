/**
 * [INPUT]: Depends on ChatStore, Section, Transcript Projects, Conversation Coordinator, owner-aware Base, summary and tools context
 * [OUTPUT]: Provides createSectionToolset, filters/taggers, Base owner abstract, from_seq read, send/create and exports attachments to field handler
 * [POS]: The only adaptation layer of the sections domain to the general built-in tool platform; The tool platform is responsible for identifying the authorization, frequency control, strict schema and wire budget, and the read transcripts and attachment data are consistent with the same result after the compression
 */

import { SECTION_EXPORT_BYTE_LIMIT } from "../../../shared/agent-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
import type { ChatStore } from "../chats/chat-store";
import type { BuiltinToolContext, BuiltinToolset } from "../tools/registry";
import type { ConversationCoordinator } from "./coordinator/conversation-coordinator";
import { readSectionTranscriptPage } from "./export-transcript";
import type { PromotableResultSource } from "../agent/subagent-spawn";
import { promoteSubagentResult } from "./promote-toolset";

export type SectionToolProviders = {
  baseSummaryForSection(
    chatId: string
  ): Promise<{
    ownerKey: string;
    owner: "own" | "project";
    rowCount: number;
  } | null>;
  isEffectiveArchived?(chatId: string): boolean;
  exportAttachment(
    sectionId: string,
    attachmentId: string
  ): Promise<{ path: string; filename: string; media_type: string; bytes: number }>;
  promotableResults?: PromotableResultSource;
};

// 发起方 CLI 的 MCP result 可见上限生效时：JSON 转义最坏 2×，取预算一半再留封套余量
function transcriptByteLimit(context: BuiltinToolContext) {
  return Math.max(
    1,
    Math.min(
      SECTION_EXPORT_BYTE_LIMIT,
      Math.floor(context.lease.resultByteBudget / 2) - 1024
    )
  );
}

const READ_SECTION_ATTACHMENT_LIMIT = 16;
const READ_SECTION_MIN_TRANSCRIPT_BYTES = 4 * 1024;

/* attachments 字段与 transcript 同吃一份 result 预算，且同样会被 JSON 转义
   最坏放大 2×。下限不能用 Math.max 兜——那等于把 413 放回来，正确做法是削减
   附件条数直到转录仍有活路。 */
const attachmentEnvelopeBytes = (attachments: readonly unknown[]) =>
  Buffer.byteLength(JSON.stringify(attachments), "utf8") * 2 + 512;

const pageThroughSeq = (page: { next_from_seq?: number }) =>
  page.next_from_seq === undefined
    ? Number.MAX_SAFE_INTEGER
    : page.next_from_seq - 1;

/** 与当前转录页对齐：只列本页幸存消息的附件；完整清单以转录占位行为准。 */
function pageAttachments(
  record: ChatRecord,
  fromSeq: number | undefined,
  throughSeq: number,
  limit: number
) {
  return record.messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.seq >= (fromSeq ?? 0) &&
        message.seq <= throughSeq
    )
    .flatMap((message) =>
      message.role === "user" ? message.attachments ?? [] : []
    )
    .slice(0, limit)
    .map((attachment) => ({
      attachment_id: attachment.id,
      filename: attachment.filename,
      media_type: attachment.mediaType,
      bytes: attachment.byteSize,
    }));
}

const attachmentTotal = (record: ChatRecord) =>
  record.messages.reduce(
    (total, message) =>
      total +
      (message.role === "user" ? message.attachments?.length ?? 0 : 0),
    0
  );

function sectionCursor(value: unknown) {
  if (value === undefined) return 0;
  try {
    const offset = Number(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw Object.assign(new Error("Section cursor 无效"), { status: 400 });
  }
}

const encodeSectionCursor = (offset: number) =>
  Buffer.from(String(offset), "utf8").toString("base64url");

export function createSectionToolset(
  chats: ChatStore,
  coordinator: ConversationCoordinator,
  providers: SectionToolProviders
): BuiltinToolset {
  return {
    list_sections: async (args) => {
      const visible = chats
        .list()
        .filter(({ id }) => !providers.isEffectiveArchived?.(id));
      const sections = await Promise.all(
        visible.map(async ({ id, title, agent, updatedAt }) => {
          const base = await providers.baseSummaryForSection(id);
          return {
            id,
            title,
            agent,
            updatedAt,
            has_base: Boolean(base),
            ...(base
              ? {
                  base_row_count: base.rowCount,
                  base_owner: base.owner,
                  base_owner_key: base.ownerKey,
                }
              : {}),
          };
        })
      );
      const offset = sectionCursor(args.cursor);
      const limit = args.limit as number;
      const page = sections.slice(offset, offset + limit);
      return {
        sections: page,
        ...(offset + page.length < sections.length
          ? { nextCursor: encodeSectionCursor(offset + page.length) }
          : {}),
      };
    },
    read_section: async (args, context) => {
      const sectionId = args.section_id as string;
      const record = await chats.get(sectionId);
      if (!record) {
        throw Object.assign(new Error("Section 不存在"), { status: 404 });
      }
      const fromSeq = args.from_seq as number | undefined;
      const budget = transcriptByteLimit(context);
      /* 附件取页要与转录页对齐，而转录页宽度又取决于附件占多少封套——先用
         满预算探一页定出候选，削到转录仍有活路，再按最终页收敛（页只会更窄，
         候选恒为其前缀）。 */
      const probe = readSectionTranscriptPage(record, budget, fromSeq);
      let candidates = pageAttachments(
        record,
        fromSeq,
        pageThroughSeq(probe),
        READ_SECTION_ATTACHMENT_LIMIT
      );
      while (
        candidates.length &&
        budget - attachmentEnvelopeBytes(candidates) <
          READ_SECTION_MIN_TRANSCRIPT_BYTES
      ) {
        candidates = candidates.slice(0, -1);
      }
      const page = readSectionTranscriptPage(
        record,
        Math.max(1, budget - attachmentEnvelopeBytes(candidates)),
        fromSeq
      );
      return {
        section_id: sectionId,
        effective_archived:
          providers.isEffectiveArchived?.(sectionId) ?? false,
        attachments: pageAttachments(
          record,
          fromSeq,
          pageThroughSeq(page),
          candidates.length
        ),
        attachments_total: attachmentTotal(record),
        ...page,
      };
    },
    send_to_section: (args, context) =>
      coordinator.sendToSection(
        {
          sectionId: args.section_id as string,
          message: args.message as string,
          expectReply: (args.expect_reply as boolean | undefined) ?? true,
        },
        context
      ),
    create_section: (args, context) =>
      coordinator.createSection(
        {
          firstMessage: args.first_message as string,
          ...(args.title ? { title: args.title as string } : {}),
          ...(args.agent ? { agent: args.agent as string } : {}),
          inheritProject: (args.inherit_project as boolean | undefined) ?? false,
          contextSectionIds: [
            ...new Set((args.context_section_ids as string[] | undefined) ?? []),
          ],
        },
        context
      ),
    promote_result_to_section: (args, context) => {
      if (!providers.promotableResults) {
        throw Object.assign(new Error("Subagent 结果提升服务不可用"), { status: 503 });
      }
      return promoteSubagentResult(
        args as Parameters<typeof promoteSubagentResult>[0],
        context,
        providers.promotableResults,
        coordinator
      );
    },
    export_attachment: async (args) => ({
      ...(await providers.exportAttachment(
        args.section_id as string,
        args.attachment_id as string
      )),
      effective_archived:
        providers.isEffectiveArchived?.(args.section_id as string) ?? false,
    }),
  };
}
