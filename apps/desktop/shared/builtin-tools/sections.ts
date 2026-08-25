/**
 * [INPUT]: Depends on zod and the type of Section id, annotations, spec of the builtin-tools/platform
 * [OUTPUT]: Provides live reading, Project inheritance, Subagent results upgrading and manually-only attachments exported Sections Six static specs
 * [POS]: The truth source in the Sections field of builtin-tools; Just down the platform
 */

import { z } from "zod";
import {
  mutation,
  read,
  entityId,
  sectionId,
  type BuiltinToolSpec,
} from "./platform";

/* 选型指引同步点：本常量、subagents.ts 的 spawn_subagent description、
 * resources/skills/section-collab-read/SKILL.md 三处口径需人工联动核对，改一处查三处。 */
const collaborationHint =
  "Section 指侧边栏中的 chat；当前回合内委派一次性任务请用 spawn_subagent，需要把其结果持久化、让用户可见并可续聊时尽快使用 promote_result_to_section；直接创建并启动持久协作使用 create_section。";
const collaborationReference = {
  mentions: ["spawn_subagent", "promote_result_to_section", "create_section"],
  text: collaborationHint,
} as const;

export const SECTION_TOOL_SPECS = [
  {
    name: "list_sections",
    domainId: "sections",
    access: "read",
    description:
      "列出全部持久化 Section；有 Base 时返回 base_owner=own|project、base_owner_key 与行数，多个 Section 可指向同一 Project Base。",
    crossReferences: [collaborationReference],
    inputSchema: z
      .object({
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .strict(),
    annotations: read,
  },
  {
    name: "read_section",
    domainId: "sections",
    access: "read",
    description:
      "跨 Section 按整条消息执行独立 live 正向查询；attachments 只列本页幸存消息的附件元数据、最多 16 条（原件只随显式 @Section 输入交割），attachments_total 是该 Section 全部附件总数，完整清单以转录中的附件占位行为准；from_seq 为 inclusive 起点，返回 next_from_seq 时原样续读，incarnation/trimmedThroughSeq 用于识别换代或历史裁剪；它不是 @chat tail 快照的下一页。",
    crossReferences: [collaborationReference],
    inputSchema: z
      .object({
        section_id: sectionId,
        from_seq: z.number().int().nonnegative().optional(),
      })
      .strict(),
    annotations: read,
  },
  {
    name: "send_to_section",
    domainId: "sections",
    access: "mutate",
    description:
      "向显式 section_id 指定的另一个 Section 排队投递并触发其 Agent。",
    crossReferences: [collaborationReference],
    inputSchema: z
      .object({
        section_id: sectionId,
        message: z.string().trim().min(1).max(32 * 1024),
        expect_reply: z.boolean().optional(),
      })
      .strict(),
    annotations: mutation,
  },
  {
    name: "create_section",
    domainId: "sections",
    access: "mutate",
    description:
      "创建一个新的持久 general Section 并排队首轮；inherit_project 只会继承调用方自己 external-bound Project，不能指定任意 Project。",
    crossReferences: [collaborationReference],
    inputSchema: z
      .object({
        first_message: z.string().trim().min(1).max(32 * 1024),
        title: z.string().trim().min(1).max(200).optional(),
        /* 工具入参是「可被指派的后端」，与「系统认识哪些后端」不是同
           一个问题：故硬编码而非从 AGENT_BACKEND_ORDER 派生。
           opencode v1 不承接 Section 指派。 */
        agent: z.enum(["codex", "claude", "kimi"]).optional(),
        inherit_project: z.boolean().optional(),
        context_section_ids: z.array(sectionId).max(8).optional(),
      })
      .strict(),
    annotations: mutation,
  },
  {
    name: "promote_result_to_section",
    domainId: "sections",
    access: "mutate",
    description:
      "尽快把当前回合拥有的 Subagent 结果 best-effort 提升为 idle Section；优先取进程内完整结果，重启后回落到 durable parts，后者可能已截断。",
    crossReferences: [collaborationReference],
    inputSchema: z
      .object({
        agent_thread_id: z.string().min(1).max(256),
        title: z.string().trim().min(1).max(200).optional(),
        agent: z.enum(["codex", "claude", "kimi"]).optional(),
        inherit_project: z.boolean().optional(),
        note: z.string().max(2 * 1024).optional(),
      })
      .strict(),
    annotations: mutation,
  },
  {
    name: "export_attachment",
    domainId: "sections",
    access: "read",
    manualTurnOnly: true,
    description:
      "把指定 Section 消息拥有的图片附件原子导出到应用私有 exports 目录；不修改源记录，但会创建或替换本地导出文件。",
    inputSchema: z
      .object({ section_id: sectionId, attachment_id: entityId })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
] as const satisfies readonly BuiltinToolSpec[];
