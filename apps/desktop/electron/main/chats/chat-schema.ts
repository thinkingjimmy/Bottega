/**
 * [INPUT]: Depends on shared content schema factories, local Gallery part extensions and desktop context/authority contracts.
 * [OUTPUT]: Strict Chat facts, replaceable current sessions independent of imported provenance, bounded execution windows, and lineage/classification invariants.
 * [POS]: Durable Chat record authority; SQLite is the only backend and no legacy file envelope precedes it
 */

import { z } from "zod";
import { turnOptionsSchema } from "../../../shared/chat-agent/options";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import { isAbsolute } from "node:path";
import {
  SESSION_ID_BYTE_LIMIT,
} from "../../../shared/agent-ipc";
import {
  SUPERSEDED_BRANCH_LIMIT,
  SUBAGENT_BYTE_LIMIT,
  type PersistedSubagent,
  type ChatRecord,
} from "../../../shared/chats-ipc";
import {
  chatPartSchema,
  importedPartSchema,
  messageBytes,
  utf8Length,
} from "./chat-part-schema";
import { PROJECT_ID_PATTERN } from "../../../shared/projects-ipc";
import { HISTORY_SOURCE_KINDS } from "../../../shared/history-import-ipc";
import { createMessageSchemas } from "@ai-chat/cloud-protocol/chats/content/messages";

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const CHAT_MESSAGE_LIMIT = 1_000;
export const CHAT_BYTE_LIMIT = 2 * 1024 * 1024;
export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INCARNATION_ID_PATTERN = /^[a-f0-9]{32}$/;
export const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

export function referencedSubagents(parts: readonly { type: string; agentThreadId?: string }[], available: ChatRecord["subagents"]) {
  const result: Record<string, PersistedSubagent> = {}, pending = [...parts];
  for (let index = 0; index < pending.length; index++) {
    const part = pending[index]!;
    if (part.type !== "subagent" || !part.agentThreadId || result[part.agentThreadId]) continue;
    const value = available?.[part.agentThreadId];
    if (value) { result[part.agentThreadId] = value; pending.push(...value.parts); }
  }
  return result;
}

/** Select execution context without discarding the caller's saved history. */
export function chatExecutionWindow(record: ChatRecord): ChatRecord {
  let from = record.messages.length, bytes = 0, agentBytes = 2;
  const agents: Record<string, PersistedSubagent> = {};
  while (from > 0 && record.messages.length - from < CHAT_MESSAGE_LIMIT) {
    const message = record.messages[from - 1]!, size = messageBytes(message);
    const additions = message.role === "assistant" ? Object.keys(referencedSubagents(message.parts ?? [], record.subagents)).filter(id => !agents[id]) : [];
    const addedBytes = additions.reduce((sum, id) => sum + utf8Length(JSON.stringify(id)) + 2 + utf8Length(JSON.stringify(record.subagents![id])), 0);
    if (bytes + size > CHAT_BYTE_LIMIT || agentBytes + addedBytes > SUBAGENT_BYTE_LIMIT) break;
    for (const id of additions) agents[id] = record.subagents![id]!;
    bytes += size; agentBytes += addedBytes; from--;
  }
  if (from === record.messages.length && from > 0) throw new Error("CHAT_MESSAGE_CONTEXT_TOO_LARGE");
  return chatRecordSchema.parse({ ...record, messages: record.messages.slice(from), subagents: agents,
    trimmedThroughSeq: from ? record.messages[from - 1]!.seq : record.trimmedThroughSeq });
}

// Local part provenance extends the shared content grammar at the storage boundary.
export {
  PART_TITLE_CHAR_LIMIT,
  chatPartInputSchema,
  chatPartSchema,
  messageBytes,
  utf8Length,
} from "./chat-part-schema";

/** One aggregate Subagent budget for load and commit reconstruction. */
export function assertSubagentBudget(
  subagents: Record<string, PersistedSubagent> | undefined
) {
  if (
    subagents &&
    utf8Length(JSON.stringify(subagents)) > SUBAGENT_BYTE_LIMIT
  ) {
    throw new Error("subagents 总量不能超过 2 MB");
  }
}

export const { messageSchema, subagentsSchema } = createMessageSchemas(chatPartSchema, importedPartSchema);

const supersededBranchSchema = z
  .object({
    intentId: z.string().regex(MESSAGE_ID_PATTERN),
    supersededAt: z.number().int().nonnegative(),
    supersedesUserMessageId: z.string().regex(MESSAGE_ID_PATTERN),
    throughSeqEnd: z.number().int().positive(),
    messages: z.array(messageSchema).max(CHAT_MESSAGE_LIMIT),
  })
  .strict()
  .superRefine((branch, context) => {
    const first = branch.messages[0];
    const last = branch.messages.at(-1);
    if (
      first?.role !== "user" ||
      first.id !== branch.supersedesUserMessageId ||
      last?.seq !== branch.throughSeqEnd
    ) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "修订分支档必须精确覆盖被替代 user 到 throughSeqEnd",
      });
    }
  });

const recordFields = {
  id: z.string().regex(CHAT_ID_PATTERN),
  incarnationId: z.string().regex(INCARNATION_ID_PATTERN),
  title: z.string().trim().min(1).max(200).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  nextSeq: z.number().int().positive(),
  /* 裁剪现场记账：预算裁掉的最大 seq。事后无法从残留消息倒推
     「本来还有什么」——不在现场记，授权证据与交付水位就永远对不上。 */
  trimmedThroughSeq: z.number().int().nonnegative().optional(),
  supersededBranches: z
    .array(supersededBranchSchema)
    .max(SUPERSEDED_BRANCH_LIMIT)
    .default([]),
  supersededBranchesTrimmedThroughSeq: z.number().int().nonnegative().optional(),
  messages: z.array(messageSchema).max(CHAT_MESSAGE_LIMIT),
  subagents: subagentsSchema.optional(),
};

const canonicalRecordFields = {
  ...recordFields,
  homeDir: z
    .string()
    .min(1)
    .max(2048)
    .refine(isAbsolute, "homeDir 必须是绝对路径")
    .nullable(),
  executionDir: z
    .string()
    .min(1)
    .max(2048)
    .refine(isAbsolute, "executionDir 必须是绝对路径")
    .nullable()
    .optional(),
  archivedAt: z.number().int().nonnegative().optional(),
  /* Manual sidebar position as a virtual createdAt (finite double, creation-ms space); absent = never moved. */
  sortKey: z.number().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
};

const appCapabilityGrantSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    data: z
      .object({
        kind: z.literal("base"),
        level: z.enum(["read", "row-write"]),
      })
      .strict()
      .optional(),
    agentDelegation: z
      .object({ fileRead: z.boolean(), useData: z.boolean() })
      .strict(),
    grantedAt: z.number().int().nonnegative(),
  })
  .strict();
const appDisabledGrantSchema = z
  .object({
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    state: z.literal("disabled"),
    disabledAt: z.number().int().nonnegative(),
  })
  .strict();

const appGrantFields = {
  grants: z
    .array(z.union([appCapabilityGrantSchema, appDisabledGrantSchema]))
    .superRefine((grants, context) => {
      const seen = new Set<string>();
      grants.forEach((grant, index) => {
        if (seen.has(grant.appId)) {
          context.addIssue({
            code: "custom",
            path: [index, "appId"],
            message: "同一 chat 只能保存一份 App grant",
          });
        }
        seen.add(grant.appId);
      });
    }),
  grantRevision: z.number().int().nonnegative(),
};

const conversationContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ordinary") }).strict(),
  z.object({ kind: z.literal("app-use"), appId: z.string().min(1).max(128) }).strict(),
  z
    .object({
      kind: z.literal("app-edit"),
      appId: z.string().min(1).max(128),
      projectId: z.string().regex(PROJECT_ID_PATTERN),
    })
    .strict(),
]);

const chatStartStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unstarted") }).strict(),
  z
    .object({
      kind: z.literal("started-exact"),
      firstUserMessageAt: z.number().int().nonnegative(),
      firstUserMessageSeq: z.number().int().positive(),
    })
    .strict(),
]);

const titleJobSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z
    .object({
      state: z.literal("pending"),
      jobId: z.string().min(1).max(256),
      expectedRecordRevision: z.number().int().positive(),
      expectedTitleSource: z.enum(["app-fallback", "local-fallback"]),
      createdAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      state: z.literal("completed"),
      jobId: z.string().min(1).max(256),
      completedAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      state: z.literal("superseded"),
      jobId: z.string().min(1).max(256),
      supersededAt: z.number().int().nonnegative(),
    })
    .strict(),
]);

function validateRecord(
  record: {
    messages: Array<Parameters<typeof messageBytes>[0]>;
  },
  context: z.core.$RefinementCtx
) {
  const branches =
    (record as { supersededBranches?: unknown[] }).supersededBranches ?? [];
  const bytes = record.messages.reduce(
    (total, message) => total + messageBytes(message),
    0
  ) + (branches.length ? utf8Length(JSON.stringify(branches)) : 0);
  if (bytes > CHAT_BYTE_LIMIT) {
    context.addIssue({
      code: "custom",
      path: ["messages"],
      message: "聊天消息总量不能超过 2 MB",
      input: record,
    });
  }
  const sequences = record.messages
    .map((message) => (message as { seq?: number }).seq)
    .filter((value): value is number => value !== undefined);
  const nextSeq = (record as { nextSeq?: number }).nextSeq;
  if (nextSeq !== undefined) {
    if (
      sequences.length !== record.messages.length ||
      new Set(sequences).size !== sequences.length ||
      sequences.some((seq, index) => index > 0 && seq <= sequences[index - 1]!)
    ) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "canonical messages 必须按唯一递增 seq 排列",
        input: record,
      });
    }
    if (sequences.length > 0 && nextSeq <= sequences.at(-1)!) {
      context.addIssue({
        code: "custom",
        path: ["nextSeq"],
        message: "nextSeq 必须大于所有已落盘消息",
        input: record,
      });
    }
  }
}

/* 事实与消息在此分家：ChatFacts 是剥掉消息、子代理、被取代分支的那一半。
   窄事实写入与整聚合写入共用同一份字段清单，第二份真相无处生长。 */
const {
  messages: messagesField,
  subagents: subagentsField,
  supersededBranches: supersededBranchesField,
  supersededBranchesTrimmedThroughSeq: branchWatermarkField,
  ...factCanonicalFields
} = canonicalRecordFields;

const chatFactFields = {
  ...factCanonicalFields,
  ...appGrantFields,
  parentChatId: z.string().regex(CHAT_ID_PATTERN).nullable().optional(),
  parentIncarnationId: z.string().regex(INCARNATION_ID_PATTERN).nullable().optional(),
  parentMessageId: z.string().regex(MESSAGE_ID_PATTERN).nullable().optional(),
  inheritedThroughSeq: z.number().int().positive().nullable().optional(),
  executionKind: z.literal("managed-worktree").nullable().optional(),
  projectId: z.string().regex(PROJECT_ID_PATTERN).nullable(),
    appRole: z.enum(["edit", "use"]).nullable(),
    context: conversationContextSchema,
    startState: chatStartStateSchema,
    titleSource: z.enum(["app-fallback", "local-fallback", "generated", "user"]),
    titleJob: titleJobSchema,
    readOnlyReason: z.enum([
      "legacy-app-not-editable",
      "external-readonly",
    ]).optional(),
    chatRecordRevision: z.number().int().positive(),
    chatMessageRevision: z.number().int().nonnegative(),
    agent: agentBackendIdSchema,
    agentRevision: z.number().int().nonnegative(),
    options: turnOptionsSchema,
    forkAgent: agentBackendIdSchema.nullable().optional(),
    session: z
      .object({
        backend: agentBackendIdSchema,
        id: z.string().min(1).refine(
          (value) => utf8Length(value) <= SESSION_ID_BYTE_LIMIT,
          "session id 过长"
        ),
        toolPlan: z
          .object({
            planDigest: z.string().regex(/^[a-f0-9]{64}$/),
            projectId: z.string().regex(PROJECT_ID_PATTERN).nullable(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .nullable(),
    importOrigin: z
      .object({
        sourceKind: z.enum(HISTORY_SOURCE_KINDS),
        storageFingerprint: z.string().min(1).max(512),
        canonicalNativeId: z.string().min(1).max(512),
        aliases: z.array(z.string().min(1).max(512)).max(64),
        resumeAlias: z.string().min(1).max(512),
        originalCwd: z.string().min(1),
        historyRevision: z.string().min(1).max(512),
        adoptionSnapshotId: z.string().regex(/^adopt_[a-f0-9]{64}$/).optional(),
        sourceSize: z.number().int().nonnegative(),
        sourceMtimeNs: z.string().regex(/^\d+$/),
        // 读侧投影位：分隔线与未完成尾部提示的取值来源，落盘不依赖它们。
        sourceStatus: z.enum(["match", "changed", "missing"]).optional(),
        incompleteTail: z.boolean().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
};

function validateFacts(
  record: z.infer<typeof strictChatFactsSchema>,
  context: z.core.$RefinementCtx
) {
  const lineage = [
    record.parentChatId,
    record.parentIncarnationId,
    record.parentMessageId,
    record.inheritedThroughSeq,
  ];
  const lineageCount = lineage.filter((value) => value !== null && value !== undefined).length;
  if (lineageCount !== 0 && lineageCount !== lineage.length) {
    context.addIssue({
      code: "custom",
      path: ["parentChatId"],
      message: "fork lineage facts must be all-null or all-present",
      input: record,
    });
  }
  if (Boolean(record.executionDir) !== Boolean(record.executionKind)) {
    context.addIssue({
      code: "custom",
      path: ["executionDir"],
      message: "managed-worktree executionDir and executionKind must coexist",
      input: record,
    });
  }
  if (record.createdAt > record.updatedAt) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "updatedAt 不能早于 createdAt",
      input: record,
    });
  }
  if (record.readOnlyReason === "external-readonly") {
    if (record.homeDir !== null || record.session !== null) {
      context.addIssue({
        code: "custom",
        path: ["homeDir"],
        message: "external-readonly Chat 不得携带 Home 或 Session",
        input: record,
      });
    }
  } else if (record.homeDir === null) {
    context.addIssue({
      code: "custom",
      path: ["homeDir"],
      message: "可执行 Chat 必须携带绝对 Home",
      input: record,
    });
  }
  if (record.options.backend !== record.agent) {
    context.addIssue({ code: "custom", path: ["options"], message: "Chat options must match its Agent" });
  }
  if (record.session && record.session.backend !== record.agent) {
    context.addIssue({
      code: "custom",
      path: ["session", "backend"],
      message: "session backend 必须等于 chat agent",
      input: record,
    });
  }
  if (
    Boolean(record.snapshotDigest) !==
    Boolean(record.importOrigin?.adoptionSnapshotId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["importOrigin"],
      message: "adoptionSnapshotId 与 snapshotDigest 必须同生同灭",
      input: record,
    });
  }
  const expectedRole =
    record.context.kind === "ordinary"
      ? null
      : record.context.kind === "app-use"
        ? "use"
        : "edit";
  if (record.appRole !== expectedRole) {
    context.addIssue({
      code: "custom",
      path: ["appRole"],
      message: "appRole 必须是 canonical context 的派生投影",
      input: record,
    });
  }
  if (
    record.context.kind === "app-edit" &&
    record.context.projectId !== record.projectId
  ) {
    context.addIssue({
      code: "custom",
      path: ["context", "projectId"],
      message: "App Edit context 必须绑定同一 Project",
      input: record,
    });
  }
  // A materialized empty mirror has no fabricated first user message.
  if (
    record.context.kind === "app-edit" &&
    record.startState.kind === "unstarted"
  ) {
    context.addIssue({
      code: "custom",
      path: ["startState"],
      message: "canonical App Edit Chat 必须已经开始；空编辑仅存在为 DraftIntent",
      input: record,
    });
  }
}

const strictChatFactsSchema = z.object(chatFactFields).strict();

/* 事实相：窄事实写入的唯一校验口。record 相在它之上再加消息不变式。 */
export const chatFactsSchema = strictChatFactsSchema.superRefine(validateFacts);

const recordSchemaOver = (messages: typeof messagesField) => z
  .object({
    ...chatFactFields,
    messages,
    subagents: subagentsField,
    supersededBranches: supersededBranchesField,
    supersededBranchesTrimmedThroughSeq: branchWatermarkField,
  })
  .strict()
  .superRefine((record, context) => {
    validateRecord(record, context);
    validateFacts(record, context);
  });

export const chatRecordSchema = recordSchemaOver(messagesField);

/* 只读相：同一份记录契约，只是不再要求「至少一条消息」。一次导入可以
   什么都没有——空源文件不该在读侧变成一条无法投影的记录。 */
export const readonlyChatRecordSchema = recordSchemaOver(
  z.array(messageSchema).max(CHAT_MESSAGE_LIMIT)
);
