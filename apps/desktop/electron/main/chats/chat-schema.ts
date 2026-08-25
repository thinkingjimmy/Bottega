/**
 * [INPUT]: Depends on the zod, shared/agent-ipc and the limiting constant for chats-ipc, shared/projects-ipc PROJECT_ID_PATTERN
 * [OUTPUT]: Provides chat schema v10 ((canonical user, main-private, revision of branch files, external importOrigin+snapshotDigest, durable App grant/subagent, interrupted fact)
 * [POS]: The schema of the chats module is the single source of truth; v10 makes the external source frontend synchronized with the product backend but different domains, forcing the App Project role to be completely homeDir
 */

import { z } from "zod";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import { isAbsolute } from "node:path";
import {
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
  SESSION_ID_BYTE_LIMIT,
  TOOL_DETAIL_BYTE_LIMIT,
} from "../../../shared/agent-ipc";
import {
  MESSAGE_BYTE_LIMIT,
  MESSAGE_PART_LIMIT,
  SUPERSEDED_BRANCH_LIMIT,
  SUBAGENT_BYTE_LIMIT,
  type ChatPart,
  type ChatAttachmentMeta,
  type ChatRecord,
  type ChatToolPart,
  type PersistedSubagent,
  noticeMessageContent,
} from "../../../shared/chats-ipc";
import { PROJECT_ID_PATTERN } from "../../../shared/projects-ipc";
import { HISTORY_SOURCE_KINDS } from "../../../shared/history-import-ipc";

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

export const SCHEMA_VERSION = 10;
export const CHAT_MESSAGE_LIMIT = 1_000;
export const CHAT_BYTE_LIMIT = 2 * 1024 * 1024;
export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INCARNATION_ID_PATTERN = /^[a-f0-9]{32}$/;
export const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
export const PART_TITLE_CHAR_LIMIT = 1000;

export const utf8Length = (value: string) => Buffer.byteLength(value, "utf8");

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

// ─── 工具词表：zod 是运行时值，无法从类型自动生成，只能人工列举 ───
// 但漏项会让整轮结果写不进账本（实测：新增 kind 未同步此处 → "无法安全写入本地账本"）。
// 下方穷尽守卫把这个运行时事故前移成编译错误：少一项即 typecheck 失败。
const TOOL_KINDS = [
  "command",
  "file-change",
  "file-read",
  "web-search",
  "image",
  "reasoning",
  "user-input",
  "other",
] as const;

type MissingToolKind = Exclude<ChatToolPart["tool"], (typeof TOOL_KINDS)[number]>;
const _toolKindsExhaustive: MissingToolKind extends never ? true : never = true;
void _toolKindsExhaustive;

// 双层限额同构生成（Review 修复）：IPC 入口用宽限额只验形状，normalizeMessage
// 在入口与存储之间做截断/收敛，入口不拒真实数据。决策 7 的 4KB 只限工具 detail；
// 中间文本（ChatTextPart）只受 32KB 消息预算约束，不做单独截断。
const partSchemasWithLimit = (detailLimit: number, titleLimit: number) => {
  const tool = z
    .object({
      type: z.literal("tool"),
      itemId: z.string().min(1).max(256),
      tool: z.enum(TOOL_KINDS),
      title: z.string().min(1).max(titleLimit),
      detail: z
        .string()
        .min(1)
        .refine((value) => utf8Length(value) <= detailLimit, {
          message: "工具输出超出限制",
        })
        .optional(),
      status: z.enum(["completed", "failed"]),
    })
    .strict();
  const text = z
    .object({
      type: z.literal("text"),
      itemId: z.string().min(1).max(256),
      text: z
        .string()
        .min(1)
        .refine((value) => utf8Length(value) <= MESSAGE_BYTE_LIMIT, {
          message: "过程文本超出消息预算",
        }),
      kind: z.literal("plan").optional(),
    })
    .strict();
  const subagent = z
    .object({
      type: z.literal("subagent"),
      itemId: z.string().min(1).max(256),
      agentThreadId: z.string().min(1).max(256),
      name: z.string().min(1).max(256),
      status: z.enum(["completed", "failed"]),
      origin: z.enum(["native", "spawn"]).optional(),
      agent: agentBackendIdSchema.optional(),
    })
    .strict();
  return z.discriminatedUnion("type", [tool, text, subagent]);
};

/** 存储层严格 schema：detail ≤ 4KB（决策 7）、title ≤ 1000 字符 */
export const chatPartSchema = partSchemasWithLimit(
  TOOL_DETAIL_BYTE_LIMIT,
  PART_TITLE_CHAR_LIMIT
);
/** IPC 入口宽限 schema：detail/title 放宽只验形状，截断交给 normalizeMessage */
export const chatPartInputSchema = partSchemasWithLimit(
  MESSAGE_BYTE_LIMIT,
  100_000
);

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

/** 消息真实体积 = 最终回复 + 过程条目 + 附件元数据（决策 7 预算口径） */
export function messageBytes(message: {
  content: string;
  parts?: ChatPart[];
  attachments?: ChatAttachmentMeta[];
}) {
  let total = utf8Length(message.content);
  for (const part of message.parts ?? []) {
    total +=
      part.type === "text"
        ? utf8Length(part.text)
        : part.type === "subagent"
          ? utf8Length(part.name) + utf8Length(part.agentThreadId)
          : utf8Length(part.title) + (part.detail ? utf8Length(part.detail) : 0);
  }
  for (const attachment of message.attachments ?? []) {
    total += utf8Length(attachment.filename) + utf8Length(attachment.mediaType);
  }
  return total;
}

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
    ...nonEmptyMessageBaseFields,
    role: z.literal("assistant"),
    kind: z.literal("plan").optional(),
    parts: z.array(chatPartSchema).min(1).max(MESSAGE_PART_LIMIT).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    isError: z.boolean().optional(),
    failureKind: z
      .enum(["auth-required", "usage-limit", "unknown"])
      .optional(),
    usageLimit: usageLimitSchema.optional(),
    contextReceipt: contextReceiptSchema.optional(),
  })
  .strict()
  .superRefine((message, context) => {
    if (messageBytes(message) > MESSAGE_BYTE_LIMIT) {
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: "消息（含过程条目）不能超过 32 KB",
      });
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

const noticeMessageSchema = z
  .object({
    ...nonEmptyMessageBaseFields,
    role: z.literal("notice"),
    notice: z.discriminatedUnion("kind", [
      actionableNoticeSchema,
      failedNoticeSchema,
      manualRecoveredNoticeSchema,
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
    .refine(isAbsolute, "homeDir 必须是绝对路径"),
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

function validateRecord(
  record: {
    messages: Array<Parameters<typeof messageBytes>[0]>;
    createdAt: number;
    updatedAt: number;
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
  if (record.createdAt > record.updatedAt) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "updatedAt 不能早于 createdAt",
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

export const chatRecordSchema = z
  .object({
    ...canonicalRecordFields,
    ...appGrantFields,
    projectId: z.string().regex(PROJECT_ID_PATTERN).nullable(),
    appRole: z.enum(["edit", "use"]).nullable(),
    agent: agentBackendIdSchema,
    session: z
      .object({
        backend: agentBackendIdSchema,
        id: z.string().min(1).refine(
          (value) => utf8Length(value) <= SESSION_ID_BYTE_LIMIT,
          "session id 过长"
        ),
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
        adoptionSnapshotId: z.string().regex(/^adopt_[a-f0-9]{64}$/),
        sourceSize: z.number().int().nonnegative(),
        sourceMtimeNs: z.string().regex(/^\d+$/),
      })
      .strict()
      .nullable()
      .optional(),
    snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  })
  .strict()
  .superRefine((record, context) => {
    validateRecord(record, context);
    if (record.session && record.session.backend !== record.agent) {
      context.addIssue({
        code: "custom",
        path: ["session", "backend"],
        message: "session backend 必须等于 chat agent",
        input: record,
      });
    }
    if (Boolean(record.importOrigin) !== Boolean(record.snapshotDigest)) {
      context.addIssue({
        code: "custom",
        path: ["importOrigin"],
        message: "importOrigin 与 snapshotDigest 必须同生同灭",
        input: record,
      });
    }
    if (record.importOrigin && !record.session) {
      context.addIssue({
        code: "custom",
        path: ["session"],
        message: "收养会话必须保留原生 SessionRef",
        input: record,
      });
    }
  });

const chatFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    record: chatRecordSchema,
  })
  .strict();

/* ============================================================
 * 断代升级的唯一版本裁判：过去与未来一视同仁地 fail closed。
 * 携带版本号上抛，由调用方决定「未来档拒载」还是「旧档隔离」——
 * 判定在这里收敛成一个数字比较，调用方不再各自解读 schemaVersion。
 * ============================================================ */
export class UnsupportedChatSchemaError extends Error {
  constructor(readonly version: number) {
    super(`不支持的聊天 schemaVersion：${version}`);
    this.name = "UnsupportedChatSchemaError";
  }
}

export function parseChatFile(value: unknown): ChatRecord {
  let candidate = value;
  if (value && typeof value === "object") {
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (version === 9) {
      const record = (value as { record?: unknown }).record;
      candidate = {
        schemaVersion: SCHEMA_VERSION,
        record: record && typeof record === "object" && !Array.isArray(record)
          ? { ...record, importOrigin: null, snapshotDigest: null }
          : record,
      };
    } else if (typeof version === "number" && version !== SCHEMA_VERSION) {
      throw new UnsupportedChatSchemaError(version);
    }
  }
  const record = chatFileSchema.parse(candidate).record;
  assertSubagentBudget(record.subagents);
  return record;
}

export const serializeChatFile = (record: ChatRecord) =>
  `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, record })}\n`;
