/**
 * [INPUT]: Depends on manual-turn, shared/submission of SubmissionContentV1, PromptInput/RichInput and Gallery attachment origin/submissionData
 * [OUTPUT]: Provides Gallery-token queue DTOs, structured catalog errors, budget/workspace identity fencing, workspace-file Steer custody, CAS claims, and pure state transitions
 * [POS]: The message queue machine image of lib; React/store is only responsible for maintaining status and executing side effects
 */

import type {
  PromptInputFilePart,
  PromptInputMessage,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { ManualTurnSubmission } from "../../shared/sections-ipc";
import type { SubmissionContentV1 } from "../../shared/submission";
import type { GalleryAttachmentOrigin } from "@ai-chat/ui/hooks/use-attachment-list";

export type QueuedAttachment =
  | {
      kind: "handle";
      id: string;
      nativeFile: File;
      name: string;
      mediaType: string;
      size: number;
      origin?: GalleryAttachmentOrigin;
    }
  | {
      kind: "dataUrl";
      id: string;
      dataUrl: string;
      name: string;
      mediaType: string;
      size: number;
      origin?: GalleryAttachmentOrigin;
    };

export type QueuedPrompt = {
  richValue: RichValue;
  attachments: QueuedAttachment[];
  displayText: string;
  submissionData?: unknown;
};

export type QueueItem = {
  id: string;
  prompt: QueuedPrompt;
  /** route-independent capsule；manual/Steer wrapper 永不进队列。 */
  content?: SubmissionContentV1;
  /** transport ambiguous 时仅保留 main custody capability。 */
  custodyIntentId?: string;
  frozenAt?: number;
  outboxRef?: string;
  state: "queued" | "submitting" | "steering" | "ambiguous";
  /** Workspace 已换代：可删除/对账，但绝不能在新 cwd 重发。 */
  workspaceInvalidated?: true;
  owner?: string;
  createdAt: number;
};

export type MessageQueue = {
  items: QueueItem[];
  paused: boolean;
  error: QueueError | null;
  owners: ReadonlySet<string>;
  reorderLock: boolean;
  revision: number;
};

export type QueueError =
  | string
  | {
      copyKey:
        | "chat.queue.limit"
        | "chat.queue.chatBudget"
        | "chat.queue.enqueueFailed"
        | "chat.queue.globalBudget"
        | "chat.queue.frozenBudget"
        | "chat.queue.workspaceChanged";
      values?: Readonly<Record<string, string | number>>;
    };

export const QUEUE_LIMIT = 20;
export const QUEUE_BYTE_BUDGET = 256 * 1024 * 1024;
export const QUEUE_BYTE_BUDGET_GLOBAL = 1024 ** 3;

export const emptyMessageQueue = (): MessageQueue => ({
  items: [],
  paused: false,
  error: null,
  owners: new Set(),
  reorderLock: false,
  revision: 0,
});

const revise = (
  queue: MessageQueue,
  patch: Partial<MessageQueue>
): MessageQueue => ({ ...queue, ...patch, revision: queue.revision + 1 });

const replaceItem = (
  queue: MessageQueue,
  id: string,
  update: (item: QueueItem) => QueueItem
) => {
  const index = queue.items.findIndex((item) => item.id === id);
  if (index < 0) return queue;
  const next = update(queue.items[index]);
  if (next === queue.items[index]) return queue;
  const items = [...queue.items];
  items[index] = next;
  return revise(queue, { items });
};

const dataUrlBytes = (value: string) => {
  const comma = value.indexOf(",");
  if (comma < 0) return new TextEncoder().encode(value).byteLength;
  const payload = value.slice(comma + 1);
  return Math.ceil((payload.length * 3) / 4);
};

const contentBytes = (content: SubmissionContentV1 | undefined) =>
  content
    ? new TextEncoder().encode(JSON.stringify(content)).byteLength
    : 0;

export const queuedBytes = (queue: MessageQueue) =>
  queue.items.reduce(
    (total, item) =>
      total +
      item.prompt.attachments.reduce(
        (sum, attachment) =>
          sum +
          (attachment.kind === "handle"
            ? attachment.size
            : dataUrlBytes(attachment.dataUrl)),
        0
      ) +
      contentBytes(item.content),
    0
  );

const attachmentFromPart = (
  file: PromptInputFilePart & {
    id?: string;
    origin?: GalleryAttachmentOrigin;
  },
  id: string
): QueuedAttachment => {
  const name = file.filename ?? "attachment";
  const mediaType = file.mediaType ?? "application/octet-stream";
  if (file.nativeFile) {
    return {
      kind: "handle",
      id,
      nativeFile: file.nativeFile,
      name,
      mediaType,
      size: file.nativeFile.size,
      ...(file.origin ? { origin: file.origin } : {}),
    };
  }
  const dataUrl = file.url ?? "";
  return {
    kind: "dataUrl",
    id,
    dataUrl,
    name,
    mediaType,
    size: dataUrlBytes(dataUrl),
    ...(file.origin ? { origin: file.origin } : {}),
  };
};

export function queuedPrompt(
  message: PromptInputMessage,
  createId: () => string = () => crypto.randomUUID()
): QueuedPrompt {
  const richValue =
    message.input.kind === "rich"
      ? structuredClone(message.input.value)
      : [{ id: createId(), type: "text" as const, value: message.input.displayText }];
  return {
    richValue,
    // 保留文件自带 id（画廊附件 = 物化 hash 短名，是 selection CAS 的一部分）；仅缺失时才生成
    attachments: message.files.map((file) =>
      attachmentFromPart(file, (file as { id?: string }).id ?? createId())
    ),
    displayText: message.input.displayText,
    ...(message.submissionData !== undefined
      ? { submissionData: structuredClone(message.submissionData) }
      : {}),
  };
}

export const createQueueItem = (
  prompt: QueuedPrompt,
  now = Date.now(),
  id: string = crypto.randomUUID()
): QueueItem => ({ id, prompt, state: "queued", createdAt: now });

export function adoptAmbiguousSubmission(
  queue: MessageQueue,
  prompt: QueuedPrompt,
  envelope: ManualTurnSubmission,
  error: string,
  now = Date.now()
) {
  const existing = queue.items.find(
    (item) => item.custodyIntentId === envelope.intentId
  );
  if (existing) {
    return setQueueError(markAmbiguous(queue, existing.id), error);
  }
  const item: QueueItem = {
    ...createQueueItem(prompt, now),
    ...(envelope.content ? { content: envelope.content } : {}),
    custodyIntentId: envelope.intentId,
    frozenAt: now,
    state: "ambiguous",
  };
  return revise(queue, {
    items: [item, ...queue.items],
    paused: true,
    error,
  });
}

export function registerOwner(queue: MessageQueue, token: string) {
  if (queue.owners.has(token)) return queue;
  return revise(queue, { owners: new Set([...queue.owners, token]) });
}

export function releaseOwner(queue: MessageQueue, token: string) {
  if (!queue.owners.has(token)) return queue;
  const owners = new Set(queue.owners);
  owners.delete(token);
  const items = queue.items.map((item) => {
    if (item.owner !== token) return item;
    if (item.state === "steering") return { ...item, state: "ambiguous" as const, owner: undefined };
    if (item.state === "submitting") {
      if (item.content && item.custodyIntentId) {
        return {
          ...item,
          state: "ambiguous" as const,
          owner: undefined,
        };
      }
      return {
        ...item,
        state: "queued" as const,
        owner: undefined,
      };
    }
    return { ...item, owner: undefined };
  });
  return revise(queue, { owners, items });
}

export type QueueMutationResult = {
  queue: MessageQueue;
  accepted: boolean;
  reason?: QueueError;
};

export function enqueue(
  queue: MessageQueue,
  item: QueueItem,
  globalBytes = queuedBytes(queue)
): QueueMutationResult {
  if (queue.items.length >= QUEUE_LIMIT) {
    return {
      queue,
      accepted: false,
      reason: { copyKey: "chat.queue.limit", values: { count: QUEUE_LIMIT } },
    };
  }
  const bytes = queuedBytes({ ...queue, items: [...queue.items, item] });
  const added = bytes - queuedBytes(queue);
  if (bytes > QUEUE_BYTE_BUDGET) {
    return { queue, accepted: false, reason: { copyKey: "chat.queue.chatBudget" } };
  }
  if (globalBytes + added > QUEUE_BYTE_BUDGET_GLOBAL) {
    return { queue, accepted: false, reason: { copyKey: "chat.queue.globalBudget" } };
  }
  return {
    queue: revise(queue, { items: [...queue.items, item], error: null }),
    accepted: true,
  };
}

export const removeItem = (queue: MessageQueue, id: string) => {
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item || !editableItem(item)) return queue;
  return revise(queue, { items: queue.items.filter((candidate) => candidate.id !== id) });
};

const crossesLockedItem = (
  items: readonly QueueItem[],
  from: number,
  to: number
) => items
  .slice(Math.min(from, to), Math.max(from, to) + 1)
  .some((item) => item.state === "submitting" || item.state === "steering");

export function moveItem(queue: MessageQueue, from: number, to: number) {
  if (from < 0 || to < 0 || from >= queue.items.length || to >= queue.items.length) return queue;
  if (from === to || crossesLockedItem(queue.items, from, to)) return queue;
  const items = [...queue.items];
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  return revise(queue, { items });
}

export function promote(queue: MessageQueue, id: string) {
  const index = queue.items.findIndex((item) => item.id === id);
  if (index <= 0 || !editableItem(queue.items[index])) return queue;
  return moveItem(queue, index, 0);
}

export type ClaimResult = { queue: MessageQueue; item?: QueueItem };

const claimed = (
  queue: MessageQueue,
  index: number,
  token: string,
  state: "submitting" | "steering",
  outboxRef?: string
): ClaimResult => {
  const item = { ...queue.items[index], state, owner: token, ...(outboxRef ? { outboxRef } : {}) };
  const items = [...queue.items];
  items[index] = item;
  return { queue: revise(queue, { items }), item };
};

export function claimNext(queue: MessageQueue, token: string): ClaimResult {
  if (!queue.owners.has(token) || queue.reorderLock) return { queue };
  for (const [index, item] of queue.items.entries()) {
    if (item.state === "ambiguous") continue;
    if ((item.state === "submitting" || item.state === "steering") && item.owner && queue.owners.has(item.owner)) return { queue };
    // releaseOwner 恒把无主 submitting 归 ambiguous/queued，无需特判。
    if (item.state === "queued") {
      return claimed(queue, index, token, "submitting");
    }
    return { queue };
  }
  return { queue };
}

export function claimItem(queue: MessageQueue, id: string, token: string, outboxRef: string): ClaimResult {
  if (!queue.owners.has(token) || !outboxRef) return { queue };
  const index = queue.items.findIndex((item) => item.id === id);
  if (index < 0 || !editableItem(queue.items[index])) return { queue };
  return claimed(queue, index, token, "steering", outboxRef);
}

export const unclaimSteer = (queue: MessageQueue, id: string, token: string) =>
  replaceItem(queue, id, (item) =>
    item.state === "steering" && item.owner === token
      ? { ...item, state: "queued", owner: undefined, outboxRef: undefined }
      : item
  );

export function tryFreeze(
  queue: MessageQueue,
  id: string,
  token: string,
  envelope: ManualTurnSubmission,
  globalBytes = queuedBytes(queue),
  now = Date.now()
): QueueMutationResult {
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item || item.state !== "submitting" || item.owner !== token) return { queue, accepted: false };
  const added = contentBytes(envelope.content);
  if (queuedBytes(queue) + added > QUEUE_BYTE_BUDGET || globalBytes + added > QUEUE_BYTE_BUDGET_GLOBAL) {
    const reset = replaceItem(queue, id, (current) => ({ ...current, state: "queued", owner: undefined }));
    const reason = { copyKey: "chat.queue.frozenBudget" } as const;
    return {
      queue: revise(reset, { paused: true, error: reason }),
      accepted: false,
      reason,
    };
  }
  return {
    queue: replaceItem(queue, id, (current) => ({
      ...current,
      ...(envelope.content ? { content: envelope.content } : {}),
      custodyIntentId: envelope.intentId,
      frozenAt: now,
    })),
    accepted: true,
  };
}

export const settleItem = (queue: MessageQueue, id: string, token?: string) => {
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item || (token && item.owner && item.owner !== token)) return queue;
  return revise(queue, { items: queue.items.filter((candidate) => candidate.id !== id) });
};

export const resetIdentity = (queue: MessageQueue, id: string) =>
  replaceItem(queue, id, (item) => ({
    ...item,
    id: crypto.randomUUID(),
    state: item.workspaceInvalidated ? "ambiguous" : "queued",
    owner: undefined,
    content: undefined,
    custodyIntentId: undefined,
    frozenAt: undefined,
    outboxRef: undefined,
  }));

export const markAmbiguous = (queue: MessageQueue, id: string, outboxRef?: string) =>
  replaceItem(queue, id, (item) => ({
    ...item,
    state: "ambiguous",
    owner: undefined,
    ...(outboxRef ? { outboxRef } : {}),
  }));

export const markManualCustody = (
  queue: MessageQueue,
  id: string,
  custodyIntentId: string
) =>
  replaceItem(queue, id, (item) => ({
    ...item,
    state: "ambiguous",
    owner: undefined,
    custodyIntentId,
  }));

export const markWorkspaceInvalidated = (queue: MessageQueue, id: string) =>
  replaceItem(queue, id, (item) => ({
    ...item,
    state: "ambiguous",
    owner: undefined,
    workspaceInvalidated: true,
  }));

export const editableItem = (item: QueueItem) =>
  item.state === "queued" && !item.workspaceInvalidated;

export const canSteerQueueItem = (
  item: QueueItem,
  isTurnRunning: boolean
) =>
  isTurnRunning &&
  editableItem(item) &&
  !item.prompt.richValue.some((node) => node.type === "workspace-file");

export function swapWithInput(queue: MessageQueue, id: string, current?: QueuedPrompt) {
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item || !editableItem(item)) return { queue, prompt: undefined };
  const items = current
    ? queue.items.map((candidate) =>
        candidate.id === id ? { ...candidate, prompt: current } : candidate
      )
    : queue.items.filter((candidate) => candidate.id !== id);
  return { queue: revise(queue, { items }), prompt: item.prompt };
}

export const queuedFileNodeIds = (queue: MessageQueue) =>
  new Set(
    queue.items.flatMap((item) =>
      item.prompt.richValue.flatMap((node) => node.type === "file" ? [node.id] : [])
    )
  );

const workspaceBoundPrompt = (prompt: QueuedPrompt) =>
  prompt.richValue.some(
    (node) => node.type !== "text" && node.type !== "section"
  );

/**
 * Workspace 换代时，未越过 IPC 边界的条目可安全删除；已冻结或传输
 * 歧义的条目不能私自宣称“没发送”，因此保留 custody，但改为不可
 * 重发的 ambiguous 状态并暂停队列。
 */
export function invalidateWorkspaceBoundQueue(queue: MessageQueue) {
  let removed = 0;
  let retained = 0;
  const items = queue.items.flatMap<QueueItem>((item) => {
    if (!workspaceBoundPrompt(item.prompt)) return [item];
    const localOnly =
      (item.state === "queued" || item.state === "submitting") &&
      !item.custodyIntentId &&
      !item.outboxRef;
    if (localOnly) {
      removed += 1;
      return [];
    }
    retained += 1;
    return [{
      ...item,
      state: "ambiguous",
      owner: undefined,
      workspaceInvalidated: true,
    }];
  });
  if (!removed && !retained) {
    return { queue, invalidated: false, removed, retained };
  }
  return {
    queue: revise(queue, {
      items,
      paused: true,
      error: {
        copyKey: "chat.queue.workspaceChanged",
        values: { removed, retained },
      },
    }),
    invalidated: true,
    removed,
    retained,
  };
}

export const setQueuePaused = (queue: MessageQueue, paused: boolean) =>
  revise(queue, { paused });

export const setQueueError = (queue: MessageQueue, error: QueueError | null) =>
  revise(queue, { error, ...(error ? { paused: true } : {}) });

export const setReorderLock = (queue: MessageQueue, reorderLock: boolean) =>
  queue.reorderLock === reorderLock ? queue : revise(queue, { reorderLock });
