/**
 * [INPUT]: Depends on canonical Chat schemas, message normalization, cryptographic ids, and transcript Gallery source references
 * [OUTPUT]: Provides native/imported fork eligibility, deterministic title allocation, operation identity, native-envelope prefix materialization, and independent child-record construction through an exact assistant anchor
 * [POS]: Pure fork policy between the renderer/service admission boundary and ChatStore persistence
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AssistantChatMessage,
  ChatForkMode,
  ChatMessage,
  ChatRecord,
} from "../../../shared/chats-ipc";
import { MESSAGE_BYTE_LIMIT } from "../../../shared/chats-ipc";
import {
  CHAT_BYTE_LIMIT,
  CHAT_MESSAGE_LIMIT,
  chatRecordSchema,
  messageBytes,
} from "./chat-schema";
import { normalizeMessage } from "./chat-commit";

const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });

export const forkOperationId = (requestId: string) =>
  `fork_${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}`;

const stripTerminalForkSuffix = (title: string) =>
  title.replace(/ \((?:[2-9]|[1-9]\d+)\)$/u, "");

const takeUtf16 = (value: string, units: number) => {
  let result = value.slice(0, Math.max(0, units));
  const tail = result.charCodeAt(result.length - 1);
  if (tail >= 0xd800 && tail <= 0xdbff) result = result.slice(0, -1);
  return result;
};

export function allocateForkTitle(sourceTitle: string | null, titles: Iterable<string | null>) {
  const root = stripTerminalForkSuffix(sourceTitle?.trim() || "New chat");
  const occupied = new Set([...titles].filter((title): title is string => Boolean(title)));
  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${takeUtf16(root, 200 - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate fork title");
}

export type ForkAnchor = Readonly<{
  anchor: AssistantChatMessage;
  retained: ChatMessage[];
}>;

export type MaterializedForkPrefix = Readonly<{
  anchor: AssistantChatMessage;
  messages: ChatMessage[];
}>;

export function requireForkSource(source: ChatRecord) {
  if (
    source.context.kind !== "ordinary" ||
    (source.readOnlyReason && source.readOnlyReason !== "external-readonly") ||
    source.executionKind ||
    !source.projectId
  ) {
    throw conflict("CHAT_FORK_SOURCE_INELIGIBLE");
  }
}

export function requireForkAnchor(
  source: ChatRecord,
  expected: Readonly<{
    sourceIncarnationId: string;
    anchorMessageId: string;
    anchorSeq: number;
  }>
): ForkAnchor {
  requireForkSource(source);
  if (source.incarnationId !== expected.sourceIncarnationId) {
    throw conflict("CHAT_FORK_SOURCE_STALE");
  }
  const anchorIndex = source.messages.findIndex(
    (item) => item.id === expected.anchorMessageId
  );
  const message = source.messages[anchorIndex];
  if (
    !message ||
    message.seq !== expected.anchorSeq ||
    message.role !== "assistant" ||
    message.isError ||
    message.failure ||
    (!message.content.trim() && !(message.parts?.length))
  ) {
    throw conflict("CHAT_FORK_ANCHOR_INELIGIBLE");
  }
  const retained = source.messages.slice(0, anchorIndex + 1);
  if (!retained.some((item) => item.role === "user")) {
    throw conflict("CHAT_FORK_PREFIX_HAS_NO_USER");
  }
  return { anchor: message, retained };
}

const nextId = (prefix: string, generateId: () => string) =>
  `${prefix}_${generateId().replaceAll("-", "")}`.slice(0, 128);

function cloneMessage(
  source: ChatRecord,
  message: ChatMessage,
  seq: number,
  generateId: () => string
): ChatMessage {
  const { segment: _segment, ...messageCopy } = structuredClone(message);
  const base = {
    ...messageCopy,
    id: nextId("msg", generateId),
    seq,
  };
  if (base.role !== "assistant" || !base.parts?.length) {
    return normalizeMessage(base as ChatMessage);
  }
  const parts = base.parts.map((part) => {
    const itemId = nextId("part", generateId);
    if (part.type !== "tool" || part.tool !== "image" || part.status !== "completed") {
      return { ...part, itemId };
    }
    const mediaSource = part.mediaSource ?? {
      kind: "transcript" as const,
      chatId: source.id,
      incarnationId: source.incarnationId,
      assistantSeq: message.seq,
      itemId: part.itemId,
    };
    const { detail: _detail, ...image } = part;
    return { ...image, itemId, mediaSource };
  });
  const candidate = { ...base, parts };
  if (messageBytes(candidate) <= MESSAGE_BYTE_LIMIT) return normalizeMessage(candidate);
  const withoutProvenance = {
    ...candidate,
    parts: candidate.parts?.map((part) => {
      if (part.type !== "tool" || !part.mediaSource) return part;
      const { mediaSource: _mediaSource, ...rest } = part;
      return rest;
    }),
  };
  /* 可选 provenance 先于任何文本让位；剩下的 32 KiB 收敛由 normalizeMessage 自己完成。 */
  return normalizeMessage(withoutProvenance);
}

export function materializeForkPrefix(
  source: ChatRecord,
  expected: Readonly<{
    sourceIncarnationId: string;
    anchorMessageId: string;
    anchorSeq: number;
  }>,
  generateId: () => string = randomUUID
): MaterializedForkPrefix {
  const { anchor, retained } = requireForkAnchor(source, expected);
  const messages = retained.map((message, index) =>
    cloneMessage(source, message, index + 1, generateId)
  );
  const bytes = messages.reduce((total, message) => total + messageBytes(message), 0);
  if (messages.length > CHAT_MESSAGE_LIMIT || bytes > CHAT_BYTE_LIMIT) {
    throw conflict("CHAT_FORK_PREFIX_TOO_LARGE");
  }
  return { anchor, messages };
}

export function createForkedChatRecord(input: Readonly<{
  source: ChatRecord;
  childChatId: string;
  childIncarnationId?: string;
  title: string;
  homeDir: string;
  executionDir?: string | null;
  mode: ChatForkMode;
  anchorMessageId: string;
  anchorSeq: number;
  now: number;
  generateId?: () => string;
}>) {
  const generateId = input.generateId ?? randomUUID;
  const { messages } = materializeForkPrefix(input.source, {
    sourceIncarnationId: input.source.incarnationId,
    anchorMessageId: input.anchorMessageId,
    anchorSeq: input.anchorSeq,
  }, generateId);
  const firstUser = messages.find((message) => message.role === "user")!;
  return chatRecordSchema.parse({
    id: input.childChatId,
    incarnationId: input.childIncarnationId ?? randomUUID().replaceAll("-", ""),
    title: input.title,
    titleSource: "user",
    titleJob: { state: "none" },
    agent: input.source.agent,
    session: null,
    importOrigin: null,
    snapshotDigest: null,
    projectId: input.source.projectId,
    appRole: null,
    context: { kind: "ordinary" },
    startState: {
      kind: "started-exact",
      firstUserMessageAt: firstUser.createdAt,
      firstUserMessageSeq: firstUser.seq,
    },
    parentChatId: input.source.id,
    parentIncarnationId: input.source.incarnationId,
    parentMessageId: input.anchorMessageId,
    inheritedThroughSeq: messages.length,
    executionDir: input.executionDir ?? null,
    executionKind: input.mode === "new-worktree" ? "managed-worktree" : null,
    chatRecordRevision: 1,
    chatMessageRevision: 1,
    grants: [],
    grantRevision: 0,
    homeDir: input.homeDir,
    createdAt: input.now,
    updatedAt: input.now,
    nextSeq: messages.length + 1,
    supersededBranches: [],
    messages,
  });
}
