/**
 * [INPUT]: Depends on React external store, nanoid, PromptInput/RichInput, typed attachment matching, Gallery origin, message queues and file authorization release
 * [OUTPUT]: Provides per-chat draft/files/queue/ACK, submission gate, images carried through a window move (F-34b) with unavailable chips, and a store-wide queue feed for background runners (F-34c) (a Project switch reports how many file / Skill references left the draft; F-46 ④), draft-owned workspace reference provenance, live input snapshots, attachment commands, Sketch ownership and migration custody, and an App's unsent Edit draft following the remote Edit Chat that displaced it (U06 Q7-c3).
 * [POS]: apps/desktop/src/lib/chat/state/composer; lib's single-owner store for uncommitted composer drafts and their identity; unlike the retrievable message caches, this store never LRU-evicts, and a generation-unknown snapshot can never silently replace a known one
 */
import { type ComposerFile, type FileResource, type ComposerState, emptyComposer } from "./model";
export { type ComposerFile, type FileNode, type ComposerState } from "./model";

import { useCallback, useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import { attachmentMatchesTarget, type AttachmentCommand } from "@ai-chat/ui/hooks/use-attachment-list";
import { PromptInputSubmissionGate } from "@ai-chat/ui/lib/prompt-input-submission";
import type { RichNode, RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";

import type { ChatsEvent } from "../../../../../shared/ipc/content/chats-ipc";
import { MESSAGE_BYTE_LIMIT } from "../../../../../shared/ipc/content/chats-ipc";
import { richInputDisplayText } from "../../../../../shared/content/rich/rich-input-projection";
import { invalidateWorkspaceBoundQueue, queuedBytes, queuedFileNodeIds } from "../../session/message-queue-model";
import type { SurfaceComposerCapsule, SurfaceComposerImage, SurfaceImageTransfer } from "../../../../../shared/ipc/settings/window-surfaces-ipc";
import { attachmentSource, ComposerImageExport, fileSource, receivedImages } from "../../../chat-composer/images";
import type { QueueItem } from "../../session/message-queue-model";
import { collectSketchResources, sketchQueueExtraBytes } from "../../../chat-composer/resources";
import { assertBudget, CACHE_BYTES, retainedBytes } from "@ai-chat/chat-ui/sketch/model/budget";


/** getSnapshot 必须身份稳定，因此缺席态是一份常量而非每次现造。 */
const EMPTY_COMPOSER: ComposerState = emptyComposer();

const entries = new Map<string, ComposerState>();
const revisions = new Map<string, number>();
export const composerRevision = (chatId: string) => revisions.get(chatId) ?? 0;
/* One submission gate per Chat, outliving the composer view: a remount while a send is in flight cannot start a second one (F-34a). */
const submissionGates = new Map<string, PromptInputSubmissionGate>();
export function composerSubmissionGate(chatId: string) {
  let gate = submissionGates.get(chatId);
  if (!gate) submissionGates.set(chatId, gate = new PromptInputSubmissionGate());
  return gate;
}
export const composerMigrating = (chatId: string) => [...ackTransfers.values()].some((transfer) => transfer.chatId === chatId && transfer.epoch === ownershipEpoch(chatId));
const listeners = new Map<string, Set<() => void>>();
type PendingComposerAck = {
  kind: "manual" | "steer";
  id: string;
  chatId: string;
};
const pendingAcks = new Map<string, PendingComposerAck>();
type AckTransfer = Readonly<{
  chatId: string;
  epoch: number;
  keys: ReadonlySet<string>;
}>;
const ackTransfers = new Map<string, AckTransfer>();
const ownershipEpochs = new Map<string, number>();
const flushingAcks = new Set<string>();

const ackKey = (ack: Pick<PendingComposerAck, "kind" | "id">) =>
  `${ack.kind}:${ack.id}`;

/** 与 queue settle 同一 updater 内调用，确保本地承诺不会先于 ack 重试记录。 */
export function registerPendingComposerAck(ack: PendingComposerAck) {
  pendingAcks.set(ackKey(ack), ack);
}

export function pendingComposerAcks(kind?: PendingComposerAck["kind"]) {
  return [...pendingAcks.values()].filter(
    (ack) =>
      (kind === undefined || ack.kind === kind) &&
      !isTransferredAck(ackKey(ack))
  );
}

const isTransferredAck = (key: string) =>
  [...ackTransfers.values()].some(
    (transfer) =>
      transfer.epoch === ownershipEpoch(transfer.chatId) &&
      transfer.keys.has(key)
  );

const ownershipEpoch = (chatId: string) => ownershipEpochs.get(chatId) ?? 0;

const advanceOwnershipEpoch = (chatId: string) => {
  const next = ownershipEpoch(chatId) + 1;
  ownershipEpochs.set(chatId, next);
  return next;
};

export async function flushPendingComposerAcks(ports: {
  manual(ids: string[]): Promise<void>;
  steer(ids: string[]): Promise<void>;
}) {
  for (const kind of ["manual", "steer"] as const) {
    const acks = pendingComposerAcks(kind);
    const available = acks.filter((ack) => !flushingAcks.has(ackKey(ack)));
    if (!available.length) continue;
    const keys = available.map(ackKey);
    for (const key of keys) flushingAcks.add(key);
    try {
      await ports[kind](available.map((ack) => ack.id));
      for (const ack of available) pendingAcks.delete(ackKey(ack));
    } catch {
      // ack 是清理优化；失败保留到下一次 attach/settle 重试。
    } finally {
      for (const key of keys) flushingAcks.delete(key);
    }
  }
}

/** Freeze this renderer's drain lane and export clone-safe state without renderer-owned file bytes. */
export async function exportComposerCapsule(
  chatId: string,
  transactionId: string
): Promise<SurfaceComposerCapsule> {
  if (readComposer(chatId).sketch.editorPins.size) throw new Error("SKETCH_EDITOR_ACTIVE");
  const images = new ComposerImageExport();
  const before = readComposer(chatId);
  await images.read([...before.draft.files.map(fileSource), ...before.queue.items.flatMap((item) => item.prompt.attachments.map(attachmentSource))]);
  const current = readComposer(chatId);
  if (current.sketch.editorPins.size) throw new Error("SKETCH_EDITOR_ACTIVE");
  const sketch = (id: string) => current.sketch.sources.has(id);
  const draftImages: SurfaceComposerImage[] = [];
  const unavailableAttachments = [...current.unavailableAttachments];
  for (const file of current.draft.files) {
    const image = images.carry(fileSource(file), sketch(file.id));
    if (image) draftImages.push(image);
    else unavailableAttachments.push({ id: file.id, name: file.filename ?? "image" });
  }
  // File chips in the draft and in queued messages move by grant ref; main rebinds every listed ref to the target window.
  const attachmentRefs = new Set<string>();
  const carryFileNodes = (value: RichValue) => value.flatMap((node): RichValue => {
    if (node.type !== "file") return [node];
    // The resource holds the current grant: a send may have renewed it without touching the node (E3-02).
    const resource = current.fileResources.get(node.id);
    if (!resource) return [];
    attachmentRefs.add(resource.node.ref);
    return [{ ...node, ref: resource.node.ref }];
  });
  const richValue = carryFileNodes(current.draft.richValue);
  const queue = current.queue.items.map((item) => {
    const itemImages = item.prompt.attachments.map((attachment) => images.carry(attachmentSource(attachment), sketch(attachment.id)));
    const lost = item.unavailableAttachment ?? item.prompt.attachments.find((_, index) => itemImages[index] === null)?.name;
    return {
      id: item.id,
      richValue: structuredClone(carryFileNodes(item.prompt.richValue)),
      displayText: item.prompt.displayText,
      ...(itemImages.length ? { images: itemImages.filter((image) => image !== null) } : {}),
      ...(lost ? { unavailableAttachment: lost } : {}),
      ...(item.content ? { content: structuredClone(item.content) } : {}),
      ...(item.custodyIntentId ? { custodyIntentId: item.custodyIntentId } : {}),
      ...(item.outboxRef ? { outboxRef: item.outboxRef } : {}),
      state: migratedQueueState(item),
      ...(item.workspaceInvalidated ? { workspaceInvalidated: true as const } : {}),
      createdAt: item.createdAt,
    };
  });
  const acks = pendingComposerAcks()
    .filter((ack) => ack.chatId === chatId)
    .map(({ kind, id }) => ({ kind, id }));
  const capsule: SurfaceComposerCapsule = {
    revision: composerRevision(chatId) + 1,
    chatId,
    incarnationId: current.incarnationId,
    workspaceIdentityKey: current.workspaceIdentityKey,
    workspaceReferences: structuredClone([...current.workspaceReferences.values()]),
    projectId: current.projectId,
    richValue: structuredClone(richValue),
    attachmentRefs: [...attachmentRefs],
    ...(draftImages.length ? { draftImages } : {}),
    ...(unavailableAttachments.length ? { unavailableAttachments } : {}),
    pendingAcks: acks,
    queue,
    queuePaused: current.queue.paused,
  };
  claimAckTransfer(transactionId, capsule);
  images.stash(transactionId);
  publish(chatId, { ...current, queue: { ...current.queue, paused: true } });
  return capsule;
}

function claimAckTransfer(
  transactionId: string,
  capsule: SurfaceComposerCapsule
) {
  if (!transactionId || ackTransfers.has(transactionId)) {
    throw new Error("Invalid composer migration transaction");
  }
  const keys = new Set(capsule.pendingAcks.map(ackKey));
  for (const key of keys) {
    if (flushingAcks.has(key) || isTransferredAck(key)) {
      throw new Error("Composer ACK transfer is already active");
    }
  }
  ackTransfers.set(transactionId, {
    chatId: capsule.chatId,
    epoch: ownershipEpoch(capsule.chatId),
    keys,
  });
  for (const key of keys) pendingAcks.delete(key);
}

function assertAckTransfer(
  transactionId: string,
  capsule: SurfaceComposerCapsule
) {
  const transfer = ackTransfers.get(transactionId);
  const expected = new Set(capsule.pendingAcks.map(ackKey));
  if (
    !transfer ||
    transfer.chatId !== capsule.chatId ||
    transfer.keys.size !== expected.size ||
    [...transfer.keys].some((key) => !expected.has(key))
  ) {
    throw new Error("Composer migration transaction mismatch");
  }
  return transfer;
}

function discardSupersededTransfer(
  transactionId: string,
  capsule: SurfaceComposerCapsule
) {
  const transfer = ackTransfers.get(transactionId);
  if (
    transfer?.chatId !== capsule.chatId ||
    transfer.epoch === ownershipEpoch(capsule.chatId)
  ) {
    return false;
  }
  ackTransfers.delete(transactionId);
  return true;
}

export function validateComposerCapsuleExport(transactionId: string, capsule: SurfaceComposerCapsule) {
  const transfer = assertAckTransfer(transactionId, capsule);
  if (transfer.epoch !== ownershipEpoch(capsule.chatId) || capsule.revision !== composerRevision(capsule.chatId)) {
    throw new Error("COMPOSER_SOURCE_REVISION_CONFLICT");
  }
}

/** Commit source retirement only after residence ownership has moved. */
export function commitComposerCapsuleExport(
  transactionId: string,
  capsule: SurfaceComposerCapsule
) {
  if (discardSupersededTransfer(transactionId, capsule)) return;
  assertAckTransfer(transactionId, capsule);
  ackTransfers.delete(transactionId);
  disposeComposer(capsule.chatId, new Set(capsule.attachmentRefs));
}

/** Restore the frozen source after any CAS, attachment-rebind, or hydrate failure. */
export function restoreComposerCapsuleExport(
  transactionId: string,
  capsule: SurfaceComposerCapsule
) {
  if (discardSupersededTransfer(transactionId, capsule)) return;
  assertAckTransfer(transactionId, capsule);
  ackTransfers.delete(transactionId);
  if (!entries.has(capsule.chatId)) {
    importComposerCapsule(capsule);
    return;
  }
  updateComposer(capsule.chatId, (current) => ({
    ...current,
    queue: { ...current.queue, paused: capsule.queuePaused },
  }));
  for (const ack of capsule.pendingAcks) {
    registerPendingComposerAck({ ...ack, chatId: capsule.chatId });
  }
}

/** Hydrate before ChatView mounts; existing main custody ids remain ambiguous and therefore cannot be resent. */
export function importComposerCapsule(capsule: SurfaceComposerCapsule, transactionId?: string, expectedRevision?: number, transfers?: readonly SurfaceImageTransfer[]) {
  if (expectedRevision !== undefined && expectedRevision !== composerRevision(capsule.chatId)) throw new Error("COMPOSER_TARGET_REVISION_CONFLICT");
  const current = readComposer(capsule.chatId);
  if (transactionId && entries.has(capsule.chatId) &&
      ((current.incarnationId && current.incarnationId !== capsule.incarnationId) ||
        richInputDisplayText(current.draft.richValue).trim() || current.draft.richValue.some((node) => node.type !== "text") || current.draft.files.length || current.queue.items.length)) {
    throw new Error("COMPOSER_MIGRATION_CONFLICT");
  }
  advanceOwnershipEpoch(capsule.chatId);
  const richValue = structuredClone(capsule.richValue) as RichValue;
  const expectedRefs = new Set(capsule.attachmentRefs);
  const fileResources = new Map<string, FileResource>();
  const adoptFileNodes = (value: RichValue) => {
    for (const node of value) {
      if (node.type !== "file" || !expectedRefs.has(node.ref)) continue;
      fileResources.set(node.id, { node });
      expectedRefs.delete(node.ref);
    }
  };
  adoptFileNodes(richValue);
  const queueRichValues = capsule.queue.map((item) => structuredClone(item.richValue) as QueueItem["prompt"]["richValue"]);
  queueRichValues.forEach(adoptFileNodes);
  if (expectedRefs.size) throw new Error("Migrated file reference has no draft node");
  // A declared image without bytes was withheld by main (or lost on the way): a chip in the draft, a held queued message.
  const received = receivedImages(transfers);
  const draftFiles: ComposerFile[] = [];
  const unavailableAttachments = [...(capsule.unavailableAttachments ?? [])];
  for (const image of capsule.draftImages ?? []) {
    const file = received.draftFile(image);
    if (file) draftFiles.push(file);
    else unavailableAttachments.push({ id: image.id, name: image.name });
  }
  const queueItems: QueueItem[] = capsule.queue.map((item, index) => {
    const attachments = (item.images ?? []).map(received.queuedAttachment);
    const lost = item.unavailableAttachment ?? item.images?.find((_, position) => attachments[position] === null)?.name;
    return {
      id: item.id,
      prompt: {
        richValue: queueRichValues[index]!,
        displayText: item.displayText,
        attachments: attachments.filter((attachment) => attachment !== null),
      },
      ...(item.content
        ? { content: structuredClone(item.content) as QueueItem["content"] }
        : {}),
      ...(item.custodyIntentId ? { custodyIntentId: item.custodyIntentId } : {}),
      ...(item.outboxRef ? { outboxRef: item.outboxRef } : {}),
      state: item.state,
      ...(item.workspaceInvalidated ? { workspaceInvalidated: true as const } : {}),
      ...(lost ? { unavailableAttachment: lost } : {}),
      createdAt: item.createdAt,
    };
  });
  publish(capsule.chatId, {
    ...current,
    incarnationId: capsule.incarnationId,
    /* 身份随胶囊落地：否则目标窗 bind 时把迁来的 file 节点判为跨工作区污染。 */
    workspaceIdentityKey: capsule.workspaceIdentityKey,
    workspaceReferences: new Map((capsule.workspaceReferences ?? []).map(reference => [reference.path, structuredClone(reference)])),
    projectId: capsule.projectId,
    draft: {
      richValue,
      files: draftFiles,
    },
    unavailableAttachments,
    fileResources,
    queue: {
      items: queueItems,
      paused: capsule.queuePaused,
      error: null,
      owners: new Set(),
      reorderLock: false,
      revision: current.queue.revision + 1,
    },
  });
  for (const ack of capsule.pendingAcks) {
    registerPendingComposerAck({ ...ack, chatId: capsule.chatId });
  }
}

/** After a send the draft text empties, and so do the unavailable chips: the person was already told those images would not go. */
export function clearSentComposerDraft(chatId: string) {
  updateComposer(chatId, (current) => ({ ...current, draft: { ...current.draft, richValue: [] }, unavailableAttachments: [] }));
}

export function removeUnavailableAttachment(chatId: string, id: string) {
  updateComposer(chatId, (current) => ({ ...current, unavailableAttachments: current.unavailableAttachments.filter((image) => image.id !== id) }));
}

const migratedQueueState = (item: QueueItem): "queued" | "ambiguous" =>
  item.state === "ambiguous" ||
  item.state === "submitting" ||
  item.state === "steering"
    ? "ambiguous"
    : "queued";

const publish = (chatId: string, next: ComposerState) => {
  const sketch = collectSketchResources(next.sketch, next.draft.files.map((file) => file.id), next.queue);
  if (sketch !== next.sketch) next = { ...next, sketch };
  revisions.set(chatId, composerRevision(chatId) + 1);
  entries.set(chatId, next);
  for (const listener of listeners.get(chatId) ?? []) listener();
  notifyAll();
  return next;
};

export const readComposer = (chatId: string) =>
  entries.get(chatId) ?? EMPTY_COMPOSER;

export function readComposerInput(chatId: string) {
  const value = readComposer(chatId).draft.richValue;
  return { kind: "rich" as const, value, displayText: richInputDisplayText(value) };
}

export function updateComposer(
  chatId: string,
  updater: (current: ComposerState) => ComposerState
) {
  const current = readComposer(chatId);
  const next = updater(current);
  if (composerMigrating(chatId) && next.draft !== current.draft) throw new Error("COMPOSER_MIGRATION_ACTIVE");
  return next === current ? current : publish(chatId, next);
}

const HOST_COMPOSE_TEXT_BYTE_LIMIT = 32 * 1024;

/**
 * A GUI may only append inert text to its already-bound chat draft. The update
 * is atomic: invalid UTF-8 budgets leave every existing node and file untouched.
 */
export function appendComposerText(chatId: string, text: string) {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (!text || bytes > HOST_COMPOSE_TEXT_BYTE_LIMIT) return false;
  let appended = false;
  updateComposer(chatId, (current) => {
    const richValue = [...current.draft.richValue];
    const tail = richValue.at(-1);
    if (tail?.type === "text") {
      const trailingNewlines = tail.value.match(/\n*$/)?.[0].length ?? 0;
      const separator = tail.value ? "\n".repeat(Math.max(0, 2 - trailingNewlines)) : "";
      richValue[richValue.length - 1] = { ...tail, value: tail.value + separator + text };
    } else {
      richValue.push({ id: `host_${nanoid()}`, type: "text", value: text });
    }
    if (
      new TextEncoder().encode(richInputDisplayText(richValue)).byteLength >
      MESSAGE_BYTE_LIMIT
    ) {
      return current;
    }
    appended = true;
    return {
      ...current,
      draft: { ...current.draft, richValue },
    };
  });
  return appended;
}

export const globalQueuedBytes = () =>
  [...entries.values()].reduce((total, state) => total + queuedBytes(state.queue, sketchQueueExtraBytes(state.sketch)), 0);

export type ComposerOwner = Readonly<{ chatId: string; epoch: number; incarnationId: string }>;
export function captureComposerOwner(chatId: string): ComposerOwner {
  if (!entries.has(chatId)) primeComposer(chatId, "");
  return { chatId, epoch: ownershipEpoch(chatId), incarnationId: readComposer(chatId).incarnationId };
}
export function composerOwnerValid(owner: ComposerOwner) {
  const state = entries.get(owner.chatId);
  return Boolean(state && owner.epoch === ownershipEpoch(owner.chatId) && (!owner.incarnationId || owner.incarnationId === state.incarnationId));
}
export function assertComposerOwner(owner: ComposerOwner, editing = true): ComposerState {
  if (!composerOwnerValid(owner)) throw new Error("SKETCH_OWNER_EXPIRED");
  if (composerMigrating(owner.chatId)) throw new Error("COMPOSER_MIGRATION_ACTIVE");
  const state = readComposer(owner.chatId);
  if (editing && !state.sketchEditable) throw new Error("SKETCH_READ_ONLY");
  return state;
}
/** Check before constructing a pure candidate; release resources only after this function returns. */
export function atomicComposerUpdate(owner: ComposerOwner, updater: (state: ComposerState) => ComposerState, editing = true) {
  const current = assertComposerOwner(owner, editing);
  const next = updater(current);
  if (next === current) return current;
  const documents = [...entries].flatMap(([id, state]) => [...(id === owner.chatId ? next : state).sketch.sources.values()].map((source) => source.document));
  const pluginBytes = [...entries].reduce((sum, [id, state]) => sum + [...((id === owner.chatId ? next : state).sketch.pluginSources?.values() ?? [])].reduce((bytes, source) => bytes + source.byteLength, 0), 0);
  assertBudget(retainedBytes(documents) + pluginBytes, CACHE_BYTES);
  return publish(owner.chatId, next);
}
export function setSketchEditable(chatId: string, editable: boolean) {
  updateComposer(chatId, (state) => state.sketchEditable === editable ? state : { ...state, sketchEditable: editable });
}

/* ─────────────────────────── 待发草稿槽 ───────────────────────────
   新会话在落盘前也需要一个 chatId：它既是本 store 的键，落盘时又直接成为
   record 的 id。这个 id 只能来自槽位，绝不能来自一次导航——react-router 的
   location.key 每 push 一换，于是「回到 New chat」在实现上就是「换一条空
   composer」，用户刚敲的字被留在一条再也没人能寻址的 entry 里。
   全渲染进程恰好一条待发草稿，槽因此无需键。模块初始化即铸造，getSnapshot
   保持纯粹。 */
const mintDraftChatId = () => `c${nanoid()}`;
let draftChatId = mintDraftChatId();
const draftListeners = new Set<() => void>();

export const readDraftChatId = () => draftChatId;

export function subscribeDraftChatId(listener: () => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

export function useDraftChatId() {
  return useSyncExternalStore(
    subscribeDraftChatId,
    readDraftChatId,
    readDraftChatId
  );
}

/** 路由叫得出名字的 chat 就不再是草稿：换新槽，旧 entry 原地留给那条真会话。 */
export function commitDraftChat(chatId: string) {
  if (draftChatId !== chatId) return;
  draftChatId = mintDraftChatId();
  for (const listener of draftListeners) listener();
}

/** Transfer the unsubmitted editor and its file/Sketch custody after a remote creation resolves. */
export function handoffComposerDraft(from: string, to: string, incarnationId: string, submitted?: import("@ai-chat/ui/components/ai-elements/prompt-input").PromptInputMessage) {
  const current = readComposer(from);
  const same = submitted?.input.kind === "rich" && JSON.stringify(current.draft.richValue) === JSON.stringify(submitted.input.value);
  /* F-07: matched by id. The submitted copy's blob: URL was converted to a data: URL on the way out, so matching by URL left
     every sent image behind as an unsent attachment. */
  const submittedIds = new Set((submitted?.files ?? []).map(file => (file as { id?: string }).id).filter((id): id is string => Boolean(id)));
  const sent = (file: ComposerFile) => submittedIds.has(file.id);
  const files = current.draft.files.filter(file => !sent(file));
  const next = { ...current, incarnationId, draft: { richValue: same ? [] : current.draft.richValue, files } };
  publish(to, next);
  // Resource ownership moves before the original editor is cleared; do not revoke transferred handles.
  publish(from, emptyComposer());
  revokeFiles(current.draft.files.filter(sent));
  retainComposerResources(to);
}

/** U06 Q7-c3: an App's unsent Edit draft follows the Edit Chat a remote first message made; a draft with nothing in it (or already moved) moves nothing. */
export function supersedeComposerDraft(from: string, to: string, incarnationId: string) {
  const { draft } = readComposer(from);
  if (!draft.files.length && !readComposerInput(from).displayText.trim()) return false;
  handoffComposerDraft(from, to, incarnationId);
  return true;
}

export function primeComposer(chatId: string, incarnationId: string) {
  const current = entries.get(chatId);
  if (!current) {
    publish(chatId, emptyComposer(incarnationId));
    return;
  }
  // "" 是「此刻还不知道世代」——快照未到、或已被 chat-messages-store 的 8 项
  // LRU 淘汰，都会给出它。它唯独不构成换代证据：把未知当新世代，等于让
  // 「翻过 8 个会话」成为一条静默的清空草稿指令。
  if (!incarnationId || current.incarnationId === incarnationId) return;
  // 落盘前就开始打字：这是它的第一世，认领而非换代。
  if (!current.incarnationId) {
    publish(chatId, { ...current, incarnationId });
    return;
  }
  disposeComposer(chatId);
  publish(chatId, emptyComposer(incarnationId));
}

const revokeFiles = (files: readonly ComposerFile[]) => {
  for (const file of files) {
    if (file.url?.startsWith("blob:")) URL.revokeObjectURL(file.url);
  }
};

export function replaceDraftFiles(chatId: string, files: ComposerFile[]) {
  return updateComposer(chatId, (current) => {
    const retained = new Set(files.map((file) => file.id));
    revokeFiles(current.draft.files.filter((file) => !retained.has(file.id)));
    return { ...current, draft: { ...current.draft, files } };
  });
}

export function applyComposerAttachmentCommand(chatId: string, command: AttachmentCommand) {
  const files = readComposer(chatId).draft.files;
  const remaining = files.filter(file => !command.targets.some(target => attachmentMatchesTarget(file, target)));
  if (remaining.length !== files.length) replaceDraftFiles(chatId, remaining);
}

export function retainComposerResources(chatId: string) {
  return updateComposer(chatId, (current) => {
    const referenced = queuedFileNodeIds(current.queue);
    for (const node of current.draft.richValue) {
      if (node.type === "file") referenced.add(node.id);
    }
    const fileResources = new Map(current.fileResources);
    for (const [id, resource] of fileResources) {
      if (referenced.has(id)) continue;
      fileResources.delete(id);
      void window.app?.releaseFile(resource.node.ref);
    }
    return fileResources.size === current.fileResources.size
      ? current
      : { ...current, fileResources };
  });
}

const workspaceIndependentNode = (node: RichNode) =>
  node.type === "text" || node.type === "section";

/**
 * 将已水合的 workspace identity 与草稿原子绑定。identity 证据持久在
 * store 而非组件 ref，所以卸载期间发生的 Project rebind 也无法绕过
 * fence。作废同时覆盖 draft 与队列；队列中跨过 IPC 边界的条目保留
 * custody 但禁止重发。旧 entry 无身份却携带 capability 节点时 fail-closed；
 * 普通 text/section 草稿则只补全基线。
 *
 * @returns 是否因身份无法证明而作废了 workspace-bound 节点。`onRemoved` gets how many file / Skill references left the
 * draft, so the composer can say so (F-46 ④) instead of dropping them silently.
 */
export function bindComposerWorkspaceIdentity(
  chatId: string,
  workspaceIdentityKey: string,
  onRemoved?: (draftNodes: number) => void
) {
  if (!workspaceIdentityKey) return false;
  let invalidated = false, removedFromDraft = 0;
  updateComposer(chatId, (current) => {
    if (current.workspaceIdentityKey === workspaceIdentityKey) return current;
    const draftInvalidated = current.draft.richValue.some(
      (node) => !workspaceIndependentNode(node)
    );
    const queueResult = invalidateWorkspaceBoundQueue(current.queue);
    invalidated = draftInvalidated || queueResult.invalidated;
    removedFromDraft = current.draft.richValue.filter((node) => !workspaceIndependentNode(node)).length;
    return {
      ...current,
      workspaceIdentityKey,
      queue: queueResult.queue,
      draft: draftInvalidated
        ? {
            ...current.draft,
            richValue: current.draft.richValue.filter(workspaceIndependentNode),
          }
        : current.draft,
    };
  });
  if (invalidated) retainComposerResources(chatId);
  if (removedFromDraft) onRemoved?.(removedFromDraft);
  return invalidated;
}

/**
 * 目标 Project 变了 ⇒ 按旧 scope 签发的 file/skill/workspace-file 节点当场失效。
 * 作废与写入必须落在同一次 publish：拆成两步，中间那一帧的草稿就挂着一批
 * 指向别的 workspace 的授权，提交时被 main 以「文件授权不属于当前 workspace」
 * 打回。图片附件不是 workspace grant，不在此列。
 */
export function setComposerProject(chatId: string, projectId: string | null) {
  if (readComposer(chatId).projectId === projectId) return;
  updateComposer(chatId, (current) => {
    const queue = invalidateWorkspaceBoundQueue(current.queue).queue;
    return {
      ...current,
      projectId,
      workspaceIdentityKey: "",
      queue,
      draft: {
        ...current.draft,
        richValue: current.draft.richValue.filter(workspaceIndependentNode),
      },
    };
  });
  retainComposerResources(chatId);
}

/* ─────────────────────── 路由改写草稿的 Project ───────────────────────
   草稿的 scope 由路由说了算：`/` 就是根级，`/?projectId=X` 就是 X。落盘会话
   不在此列——它的归属由记录说了算，所以这里只认「此刻的待发草稿槽」。

   守卫必须读活的 `draftChatId` 而不是调用方捕获的那个：提交那一刻槽会换代，
   同一次 flush 里退役与本次写入谁先谁后无从约定，比活值即让「写进一条刚落盘
   的会话」这个竞态在结构上不成立。

   这条通道存在的理由是「没有意图」与「意图是根级」曾被压成同一个 null：路由
   只能加不能清，于是 Sidebar 的「+」把人送回同一条草稿，而那条草稿还挂着上一
   个 Project——空白页于是写着别人的名字。 */
export function setDraftRouteProject(chatId: string, projectId: string | null) {
  if (chatId !== draftChatId) return;
  setComposerProject(chatId, projectId);
}

/** Projects 列表是外部事实：目标 Project 失效即回落根级。可反复调用，收敛。 */
export function reconcileComposerProject(
  chatId: string,
  isValid: (projectId: string) => boolean
) {
  const { projectId } = readComposer(chatId);
  if (projectId === null || isValid(projectId)) return;
  setComposerProject(chatId, null);
}

function disposeComposer(
  chatId: string,
  retainedRefs: ReadonlySet<string> = new Set()
) {
  const current = entries.get(chatId);
  if (!current) return;
  advanceOwnershipEpoch(chatId);
  revokeFiles(current.draft.files);
  for (const { node } of current.fileResources.values()) {
    if (!retainedRefs.has(node.ref)) void window.app?.releaseFile(node.ref);
  }
  entries.delete(chatId);
  if (!submissionGates.get(chatId)?.isActive()) submissionGates.delete(chatId);
  for (const [key, ack] of pendingAcks) {
    if (ack.chatId === chatId) pendingAcks.delete(key);
  }
  for (const [transactionId, transfer] of ackTransfers) {
    if (transfer.chatId === chatId) ackTransfers.delete(transactionId);
  }
  for (const listener of listeners.get(chatId) ?? []) listener();
  notifyAll();
}

export function receiveComposerChatEvent(event: ChatsEvent) {
  if (event.type === "upserted" && entries.has(event.summary.id)) {
    setSketchEditable(event.summary.id, !event.summary.archivedAt && !event.summary.readOnlyReason);
  }
  if (event.type === "removed") disposeComposer(event.chatId);
  if (event.type !== "messages" && event.type !== "messages-delta") return;
  primeComposer(event.chatId, event.incarnationId);
}

/* Store-wide change feed for the background queue runners (F-34c): a revision number keeps the snapshot stable. */
const allListeners = new Set<() => void>();
let allRevision = 0;
const notifyAll = () => { allRevision++; for (const listener of allListeners) listener(); };
export const composerStoreRevision = () => allRevision;
export const readComposerQueues = () => [...entries].map(([chatId, state]) => ({ chatId, queue: state.queue }));
export const readComposerEntries = (): ReadonlyMap<string, ComposerState> => entries;
export function subscribeAllComposers(listener: () => void) { allListeners.add(listener); return () => { allListeners.delete(listener); }; }

export function subscribeComposer(chatId: string, listener: () => void) {
  const current = listeners.get(chatId) ?? new Set();
  current.add(listener);
  listeners.set(chatId, current);
  return () => {
    current.delete(listener);
    if (!current.size) listeners.delete(chatId);
  };
}

export function useComposerState(chatId: string) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeComposer(chatId, listener),
    [chatId]
  );
  const snapshot = useCallback(() => readComposer(chatId), [chatId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function resetComposerStoreForTests() {
  for (const chatId of [...entries.keys()]) disposeComposer(chatId);
  listeners.clear();
  pendingAcks.clear();
  ackTransfers.clear();
  ownershipEpochs.clear();
  flushingAcks.clear();
  draftChatId = mintDraftChatId();
  for (const listener of draftListeners) listener();
  draftListeners.clear();
}
