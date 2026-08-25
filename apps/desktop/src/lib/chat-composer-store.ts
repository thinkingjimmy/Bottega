/**
 * [INPUT]: Depends on React external store, nanoid, PromptInput/RichInput, Gallery origin, attachments, message queues and file authorization release
 * [OUTPUT]: Provides per-chat composer draft/annex/authorization/ queue/target Project ✓ Synchronize the scrapping of draft+ queue across the installation of workspace identity fence, incarnation fence with the national budget
 * [POS]: the uncommitted entry of a single owner of lib, together with its identity; Unlike retrievable message caches, the store prohibits the removal of LRU and "generation unknown" cannot pretend to replace it
 */

import { useCallback, useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import type {
  PromptInputFilePart,
  RichNode,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { ChatsEvent } from "../../shared/chats-ipc";
import {
  emptyMessageQueue,
  invalidateWorkspaceBoundQueue,
  queuedBytes,
  queuedFileNodeIds,
  type MessageQueue,
} from "./message-queue-model";

export type ComposerFile = PromptInputFilePart & {
  id: string;
  origin?: {
    kind: "gallery";
    logicalKey: string;
    sourceRevision: string;
    selectionToken: string;
    materializationToken: string;
  };
};
export type FileNode = Extract<RichNode, { type: "file" }>;
type FileResource = { file: File; node: FileNode };
type ComposerState = {
  /** "" = 尚未认领任何一世。它不是「某一世」，因此不能拿去和真实世代比大小。 */
  incarnationId: string;
  /** 草稿的目标 Project；落盘后归属由 record 接管，这个值就此定格、不再变化。 */
  projectId: string | null;
  /** "" = workspace 身份尚未水合；已知值与草稿同寿，不随组件卸载丢失。 */
  workspaceIdentityKey: string;
  queue: MessageQueue;
  handledSteerIntents: ReadonlySet<string>;
  draft: { richValue: RichValue; files: ComposerFile[] };
  fileResources: Map<string, FileResource>;
};

const emptyComposer = (incarnationId = ""): ComposerState => ({
  incarnationId,
  projectId: null,
  workspaceIdentityKey: "",
  queue: emptyMessageQueue(),
  handledSteerIntents: new Set(),
  draft: { richValue: [], files: [] },
  fileResources: new Map(),
});

/** getSnapshot 必须身份稳定，因此缺席态是一份常量而非每次现造。 */
const EMPTY_COMPOSER: ComposerState = emptyComposer();

const entries = new Map<string, ComposerState>();
const listeners = new Map<string, Set<() => void>>();
type PendingComposerAck = {
  kind: "manual" | "steer";
  id: string;
  chatId: string;
};
const pendingAcks = new Map<string, PendingComposerAck>();

const ackKey = (ack: PendingComposerAck) => `${ack.kind}:${ack.id}`;

/** 与 queue settle 同一 updater 内调用，确保本地承诺不会先于 ack 重试记录。 */
export function registerPendingComposerAck(ack: PendingComposerAck) {
  pendingAcks.set(ackKey(ack), ack);
}

function pendingComposerAcks(kind?: PendingComposerAck["kind"]) {
  return [...pendingAcks.values()].filter(
    (ack) => kind === undefined || ack.kind === kind
  );
}

export async function flushPendingComposerAcks(ports: {
  manual(ids: string[]): Promise<void>;
  steer(ids: string[]): Promise<void>;
}) {
  for (const kind of ["manual", "steer"] as const) {
    const acks = pendingComposerAcks(kind);
    if (!acks.length) continue;
    try {
      await ports[kind](acks.map((ack) => ack.id));
      for (const ack of acks) pendingAcks.delete(ackKey(ack));
    } catch {
      // ack 是清理优化；失败保留到下一次 attach/settle 重试。
    }
  }
}

const publish = (chatId: string, next: ComposerState) => {
  entries.set(chatId, next);
  for (const listener of listeners.get(chatId) ?? []) listener();
  return next;
};

export const readComposer = (chatId: string) =>
  entries.get(chatId) ?? EMPTY_COMPOSER;

export function updateComposer(
  chatId: string,
  updater: (current: ComposerState) => ComposerState
) {
  const current = readComposer(chatId);
  const next = updater(current);
  return next === current ? current : publish(chatId, next);
}

export const globalQueuedBytes = () =>
  [...entries.values()].reduce((total, state) => total + queuedBytes(state.queue), 0);

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
 * @returns 是否因身份无法证明而作废了 workspace-bound 节点。
 */
export function bindComposerWorkspaceIdentity(
  chatId: string,
  workspaceIdentityKey: string
) {
  if (!workspaceIdentityKey) return false;
  let invalidated = false;
  updateComposer(chatId, (current) => {
    if (current.workspaceIdentityKey === workspaceIdentityKey) return current;
    const draftInvalidated = current.draft.richValue.some(
      (node) => !workspaceIndependentNode(node)
    );
    const queueResult = invalidateWorkspaceBoundQueue(current.queue);
    invalidated = draftInvalidated || queueResult.invalidated;
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

function disposeComposer(chatId: string) {
  const current = entries.get(chatId);
  if (!current) return;
  revokeFiles(current.draft.files);
  for (const { node } of current.fileResources.values()) {
    void window.app?.releaseFile(node.ref);
  }
  entries.delete(chatId);
  for (const [key, ack] of pendingAcks) {
    if (ack.chatId === chatId) pendingAcks.delete(key);
  }
  for (const listener of listeners.get(chatId) ?? []) listener();
}

export function receiveComposerChatEvent(event: ChatsEvent) {
  if (event.type === "removed") disposeComposer(event.chatId);
  if (event.type !== "messages" && event.type !== "messages-delta") return;
  primeComposer(event.chatId, event.incarnationId);
}

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
  draftChatId = mintDraftChatId();
  for (const listener of draftListeners) listener();
  draftListeners.clear();
}
