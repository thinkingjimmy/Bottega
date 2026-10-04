/**
 * [INPUT]: Depends on Zod and canonical Agent identities.
 * [OUTPUT]: Provides durable notice validators and deterministic stored notice text. Includes an idempotent App-disabled transcript notice.
 * [POS]: Shared transcript notice authority; localized product rendering remains separate.
 */
import { z } from "zod";
import { agentBackendIdSchema } from "../options";
export const agentSwitchedNoticeSchema = z.object({
  kind: z.literal("agent-switched"),
  from: agentBackendIdSchema,
  to: agentBackendIdSchema,
  at: z.number().int().nonnegative(),
  agentRevision: z.number().int().nonnegative(),
  context: z.object({
    mode: z.enum(["full", "excerpts", "none"]), includedMessages: z.number().int().nonnegative().optional(), totalMessages: z.number().int().nonnegative().optional(),
    historyIncluded: z.boolean(),
    notInjected: z.boolean(),
    storageTrimmed: z.boolean(),
    lookup: z.enum(["available", "disabled", "unsupported", "unavailable"]),
  }).strict(),
}).strict();

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

/* U06-d: the Edit Chat says why its extension was not added: declined from another device (named), or left undecided for 30 minutes. A
   decline on this computer needs no notice (the person saw the dialog). */
const appExtensionDeclinedNoticeSchema = z
  .object({
    kind: z.literal("app-extension-declined"),
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    requestId: z.string().min(1).max(128),
    by: z.enum(["remote", "timeout"]),
    deviceName: z.string().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => (value.by === "remote") === (value.deviceName !== undefined), "remote-decline-names-its-device");

const appDisabledNoticeSchema = z.object({ kind: z.literal("app-disabled"), appId: z.string().regex(/^[a-z0-9]{10}$/), revision: z.number().int().nonnegative() }).strict();
export const chatNoticeSchema = z.discriminatedUnion("kind", [agentSwitchedNoticeSchema,
  actionableNoticeSchema, failedNoticeSchema, manualRecoveredNoticeSchema,
  skillDescriptionsTruncatedNoticeSchema, appChatReadyNoticeSchema, appExtensionDeclinedNoticeSchema, appDisabledNoticeSchema]);
export type ChatNotice = z.infer<typeof chatNoticeSchema>;
export function noticeMessageContent(notice: ChatNotice) {
  if (notice.kind === "agent-switched") return `Agent switched · Replies from here are by ${notice.to}`;
  if (notice.kind === "app-disabled") return "This App is closed. Running tasks stopped; queued messages will resume when it is reopened.";
  if (notice.kind === "app-chat-ready") return "App Studio session is ready.";
  if (notice.kind === "app-extension-declined") {
    return notice.by === "remote" ? `Cancelled from ${notice.deviceName}. The new version was built without the extension.`
      : "No one approved the extension in 30 minutes. The new version was built without it.";
  }
  if (notice.kind === "manual-recovered") {
    return "应用重启，这条消息的回复已中断，请重新发送。";
  }
  if (notice.kind === "skill-descriptions-truncated") {
    return "Codex 提示：为适配上下文预算，本轮部分 Skill 描述被截短。Codex 仍可使用全部 Skill，本轮回复不受影响。这条提示来自 Codex 自身，不是 Bottega 的问题。";
  }
  if (notice.kind === "relay-failed") {
    return `Section 接力失败（relay ${notice.relayId}）。`;
  }
  const label =
    notice.kind === "chain-paused"
      ? "自动接力已暂停"
      : "重启后发现未完成的 Section 接力";
  return `${label}，当前有 ${notice.pendingCount} 条待处理消息。`;
}
