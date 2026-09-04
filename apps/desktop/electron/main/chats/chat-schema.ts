/**
 * [INPUT]: Depends on the zod, shared/agent-ipc and the limiting constant for chats-ipc, shared/projects-ipc PROJECT_ID_PATTERN
 * [OUTPUT]: Provides strict schema v13 Chat facts with atomic fork lineage and managed-worktree execution bindings, canonical records, and readonly imported records
 * [POS]: Durable Chat record authority; SQLite is the only backend and no legacy file envelope precedes it
 */

import { z } from "zod";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import { isAbsolute } from "node:path";
import {
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
  SESSION_ID_BYTE_LIMIT,
} from "../../../shared/agent-ipc";
import {
  MESSAGE_BYTE_LIMIT,
  MESSAGE_PART_LIMIT,
  SUPERSEDED_BRANCH_LIMIT,
  SUBAGENT_BYTE_LIMIT,
  type PersistedSubagent,
  noticeMessageContent,
} from "../../../shared/chats-ipc";
import {
  chatPartSchema,
  importedPartSchema,
  messageBytes,
  overNativeDetail,
  utf8Length,
} from "./chat-part-schema";
import { PROJECT_ID_PATTERN } from "../../../shared/projects-ipc";
import { HISTORY_SOURCE_KINDS } from "../../../shared/history-import-ipc";
import { productFailureSchema } from "../../../shared/product-failure";

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const memoryFailureKindSchema = z.enum([
  "initialization",
  "scope-resolution",
  "policy-store",
  "runtime-configuration",
  "identity",
  "provider",
  "ownership",
  "deadline",
  "render-budget",
  "stale-capability",
]);

const memoryOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("used"), count: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("unavailable"), failureKind: memoryFailureKindSchema }).strict(),
  z.object({
    kind: z.literal("skipped"),
    reason: z.enum(["disabled", "paused", "plan-mode", "prompt-not-issued"]),
  }).strict(),
]);

const contextReceiptSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().regex(MESSAGE_ID_PATTERN),
    memory: memoryOutcomeSchema,
  })
  .strict();

export const CHAT_MESSAGE_LIMIT = 1_000;
export const CHAT_BYTE_LIMIT = 2 * 1024 * 1024;
export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INCARNATION_ID_PATTERN = /^[a-f0-9]{32}$/;
export const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

/* 过程条目的形状与限额住在 chat-part-schema.ts：这份文件讲的是「一条记录长
   什么样」，那份讲的是「一条过程条目长什么样」。旧调用点从这里取用即可，
   接缝不外泄。 */
export {
  PART_TITLE_CHAR_LIMIT,
  chatPartInputSchema,
  chatPartSchema,
  messageBytes,
  utf8Length,
} from "./chat-part-schema";

/** load 与 commit 重建共用的唯一 subagent 总预算不变量。 */
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

const attachmentMetaSchema = z
  .object({
    id: z.string().regex(ATTACHMENT_ID_PATTERN),
    filename: z
      .string()
      .min(1)
      .refine((value) => utf8Length(value) <= ATTACHMENT_FILENAME_BYTE_LIMIT, {
        message: "附件文件名过长",
      }),
    mediaType: z.string().min(1).max(100),
    byteSize: z.number().int().nonnegative(),
  })
  .strict();

const persistedSubagentSchema = z
  .object({
    meta: z
      .object({
        agentThreadId: z.string().min(1).max(256),
        name: z.string().min(1).max(256),
        model: z.string().min(1).max(200).optional(),
        origin: z.enum(["native", "spawn"]).optional(),
        agent: agentBackendIdSchema.optional(),
        status: z.enum(["completed", "errored", "shutdown", "interrupted"]),
        spawnedAt: z.number().int().nonnegative(),
        lastActivityAt: z.number().int().nonnegative(),
        resultBytes: z.number().int().nonnegative().optional(),
        resultTruncated: z.boolean().optional(),
      })
      .strict(),
    parts: z.array(chatPartSchema).max(MESSAGE_PART_LIMIT),
  })
  .strict();

export const subagentsSchema = z
  .record(z.string().min(1).max(256), persistedSubagentSchema)
  .superRefine((subagents, context) => {
    for (const [key, agent] of Object.entries(subagents)) {
      if (key !== agent.meta.agentThreadId) {
        context.addIssue({
          code: "custom",
          path: [key, "meta", "agentThreadId"],
          message: "subagent key 必须等于 meta.agentThreadId",
        });
      }
    }
  });

// 限流窗口只收词表内的值；resetsAt 必须是正整数毫秒，越界即整体拒收，
// 宁可退回"无恢复时间"的诚实卡片，也不让脏时间戳渲染成假倒计时。
const usageLimitSchema = z
  .object({
    window: z.enum(["five-hour", "weekly", "provider", "unknown"]),
    resetsAt: z.number().int().positive().optional(),
  })
  .strict();

const boundedMessageContentSchema = z.string().refine(
  (value) => utf8Length(value) <= MESSAGE_BYTE_LIMIT,
  { message: "消息不能超过 32 KB" }
);

const nonEmptyMessageContentSchema = z
  .string()
  .min(1)
  .refine((value) => utf8Length(value) <= MESSAGE_BYTE_LIMIT, {
    message: "消息不能超过 32 KB",
  });

const messageBaseFields = {
  id: z.string().regex(MESSAGE_ID_PATTERN),
  content: boundedMessageContentSchema,
  createdAt: z.number().int().nonnegative(),
  seq: z.number().int().positive(),
  // 只读导入段的投影位；只有 SQLite 读侧会写它，原生落盘从不带。
  segment: z.literal("imported").optional(),
};

const nonEmptyMessageBaseFields = {
  ...messageBaseFields,
  content: nonEmptyMessageContentSchema,
};

const userMessageSchema = z
  .object({
    ...messageBaseFields,
    role: z.literal("user"),
    attachments: z.array(attachmentMetaSchema).min(1).max(ATTACHMENT_LIMIT).optional(),
    relay: z
      .object({
        sourceSectionId: z.string().regex(CHAT_ID_PATTERN),
        chainId: z.string().min(1).max(256),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.content.trim() || message.attachments?.length) return;
    context.addIssue({
      code: "custom",
      path: ["content"],
      message: "用户消息必须包含正文或附件",
    });
  });

const assistantMessageSchema = z
  .object({
    ...messageBaseFields,
    role: z.literal("assistant"),
    kind: z.literal("plan").optional(),
    /* 形状按导入段的宽口径收，原生那 4 KiB 由 overNativeDetail 按段补回。 */
    parts: z.array(importedPartSchema).min(1).max(MESSAGE_PART_LIMIT).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    isError: z.boolean().optional(),
    failureKind: z
      .enum(["auth-required", "usage-limit", "unknown"])
      .optional(),
    failure: productFailureSchema.optional(),
    usageLimit: usageLimitSchema.optional(),
    contextReceipt: contextReceiptSchema.optional(),
  })
  .strict()
  .superRefine((message, context) => {
    if (!message.content.trim() && !message.parts?.length && !message.failure) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Assistant message requires content, parts, or ProductFailure",
      });
    }
    if (messageBytes(message) > MESSAGE_BYTE_LIMIT) {
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: "消息（含过程条目）不能超过 32 KB",
      });
    }
    if (overNativeDetail(message)) {
      context.addIssue({ code: "custom", path: ["parts"], message: "工具输出超出限制" });
    }
  });

const actionableNoticeSchema = z
  .object({
    kind: z.enum(["chain-paused", "startup-recovered"]),
    rootChainId: z.string().min(1).max(256),
    pauseEpoch: z.number().int().nonnegative(),
    actionId: z.string().min(1).max(128),
    pendingCount: z.number().int().positive(),
  })
  .strict();

const failedNoticeSchema = z
  .object({
    kind: z.literal("relay-failed"),
    rootChainId: z.string().min(1).max(256),
    relayId: z.string().min(1).max(128),
  })
  .strict();

const manualRecoveredNoticeSchema = z
  .object({
    kind: z.literal("manual-recovered"),
    intentId: z.string().min(1).max(128),
  })
  .strict();

const skillDescriptionsTruncatedNoticeSchema = z
  .object({
    kind: z.literal("skill-descriptions-truncated"),
    turnId: z.string().min(1).max(128),
  })
  .strict();

const appChatReadyNoticeSchema = z
  .object({
    kind: z.literal("app-chat-ready"),
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    appRole: z.enum(["edit", "use"]),
  })
  .strict();

const noticeMessageSchema = z
  .object({
    ...nonEmptyMessageBaseFields,
    role: z.literal("notice"),
    notice: z.discriminatedUnion("kind", [
      actionableNoticeSchema,
      failedNoticeSchema,
      manualRecoveredNoticeSchema,
      skillDescriptionsTruncatedNoticeSchema,
      appChatReadyNoticeSchema,
    ]),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.content !== noticeMessageContent(message.notice)) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "notice content 必须由 notice 载荷确定性派生",
      });
    }
  });

export const messageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  assistantMessageSchema,
  noticeMessageSchema,
]);

const supersededBranchSchema = z
  .object({
    intentId: z.string().regex(MESSAGE_ID_PATTERN),
    supersededAt: z.number().int().nonnegative(),
    supersedesUserMessageId: z.string().regex(MESSAGE_ID_PATTERN),
    throughSeqEnd: z.number().int().positive(),
    messages: z.array(messageSchema).min(1).max(CHAT_MESSAGE_LIMIT),
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
  messages: z.array(messageSchema).min(1).max(CHAT_MESSAGE_LIMIT),
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
  if (
    record.importOrigin &&
    !record.session &&
    record.readOnlyReason !== "external-readonly"
  ) {
    context.addIssue({
      code: "custom",
      path: ["session"],
      message: "收养会话必须保留原生 SessionRef",
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
  /* 空的源文件也是一份诚实的历史：只读导入段允许零条 entry，此时
     unstarted 就是实情。「必须已开始」只约束可执行的普通 Chat。 */
  if (
    record.context.kind === "ordinary" &&
    record.startState.kind === "unstarted" &&
    record.readOnlyReason !== "external-readonly"
  ) {
    context.addIssue({
      code: "custom",
      path: ["startState"],
      message: "ordinary canonical Chat 必须已开始",
      input: record,
    });
  }
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
