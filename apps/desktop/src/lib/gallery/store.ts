/**
 * [INPUT]: Depends on the shared RichInput wire projection, React external-store, Agent limits, Gallery model/media IPC, typed target/CAS and chat-composer-store
 * [OUTPUT]: Provides per-chat Gallery FSM, backend/capability epoch, occurrence-scoped, submit attachments, receive promotion fence, accurate consumption/source clearance and comment snapshot
 * [POS]: The renderer is the only owner of the unperpetuated Gallery Logic status; ChatView and the full-screen host Base are responsible for mount only
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  AGENT_INPUT_LIMIT,
  ATTACHMENT_LIMIT,
  type AgentBackendId,
} from "../../../shared/agent-ipc";
import { projectRichInput } from "../../../shared/rich-input-projection";
import {
  galleryOccurrenceKey,
  type GalleryMediaSourceRef,
} from "../../../shared/gallery-media-ipc";
import type { GalleryItem } from "./model";
import {
  readComposer,
  replaceDraftFiles,
  type ComposerFile,
} from "../chat-composer-store";
import {
  attachmentMatchesTarget,
  type AttachmentCommand,
  type AttachmentCommandTarget,
} from "@ai-chat/ui/hooks/use-attachment-list";

export type GalleryComment = {
  id: string;
  version: number;
  x: number;
  y: number;
  text: string;
};

export type GallerySelection = {
  logicalKey: string;
  sourceRef: GalleryMediaSourceRef;
  selectionToken: string;
  materialization:
    | "pending"
    | "done"
    | "suspended"
    | { state: "failed"; errorCode: string; retryable: boolean };
  attachmentId?: string;
  sourceRevision?: string;
  materializationToken?: string;
};

export type GalleryChatState = {
  selections: ReadonlyMap<string, GallerySelection>;
  comments: ReadonlyMap<string, GalleryComment[]>;
  desiredItems: ReadonlySet<string>;
  backend: AgentBackendId | null;
  imageInputAvailable: boolean | null;
  capabilityEpoch: number;
  backendEpoch: number;
};

const EMPTY: GalleryChatState = {
  selections: new Map(),
  comments: new Map(),
  desiredItems: new Set(),
  backend: null,
  imageInputAvailable: null,
  capabilityEpoch: 0,
  backendEpoch: 0,
};
const entries = new Map<string, GalleryChatState>();
const listeners = new Map<string, Set<() => void>>();

const read = (chatId: string) => entries.get(chatId) ?? EMPTY;
export const readGalleryState = (chatId: string) => read(chatId);
const publish = (chatId: string, state: GalleryChatState) => {
  entries.set(chatId, state);
  for (const listener of listeners.get(chatId) ?? []) listener();
};

export function useGalleryState(chatId: string) {
  const subscribe = useCallback((listener: () => void) => {
    const group = listeners.get(chatId) ?? new Set();
    group.add(listener);
    listeners.set(chatId, group);
    return () => {
      group.delete(listener);
      if (!group.size) listeners.delete(chatId);
    };
  }, [chatId]);
  const snapshot = useCallback(() => read(chatId), [chatId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function syncGalleryEnvironment(
  chatId: string,
  backend: AgentBackendId,
  imageInputAvailable: boolean
) {
  const state = read(chatId);
  const backendChanged = state.backend !== backend;
  const capabilityChanged =
    state.imageInputAvailable !== imageInputAvailable;
  if (!backendChanged && !capabilityChanged) return state;
  const next = {
    ...state,
    backend,
    imageInputAvailable,
    backendEpoch: state.backendEpoch + Number(backendChanged),
    capabilityEpoch:
      state.capabilityEpoch + Number(capabilityChanged),
  };
  publish(chatId, next);
  return next;
}

export function selectGalleryItem(
  chatId: string,
  item: Extract<GalleryItem, { phase: "ready" }>,
  multiple: boolean
) {
  const state = read(chatId);
  const selectionToken = crypto.randomUUID();
  const retained = multiple
    ? new Map(state.selections)
    : new Map<string, GallerySelection>();
  assertSelectionCapacity(chatId, retained, item.logicalKey);
  retained.set(item.logicalKey, {
    logicalKey: item.logicalKey,
    sourceRef: item.sourceRef,
    selectionToken,
    materialization: "pending",
  });
  // 单选替换 = 隐式移除被替换项：评论与选择同生共死，语义对齐 user-remove
  const comments = multiple
    ? state.comments
    : new Map(
        [...state.comments].filter(
          ([logicalKey]) =>
            logicalKey === item.logicalKey || retained.has(logicalKey)
        )
      );
  publish(chatId, {
    ...state,
    selections: retained,
    comments,
    desiredItems: new Set(retained.keys()),
  });
  if (!multiple) {
    retainComposerFiles(chatId, new Set([item.logicalKey]));
  }
  return finishMaterialization(chatId, item, selectionToken);
}

async function finishMaterialization(
  chatId: string,
  item: Extract<GalleryItem, { phase: "ready" }>,
  selectionToken: string
) {
  const result = await window.galleryMedia
    ?.materialize({
      sourceRef: item.sourceRef,
      destinationChatId: chatId,
    })
    .catch(() => undefined);
  const current = read(chatId);
  const selected = current.selections.get(item.logicalKey);
  if (!selected || selected.selectionToken !== selectionToken) return;
  const selections = new Map(current.selections);
  if (!result?.ok) {
    selections.set(item.logicalKey, {
      ...selected,
      materialization: {
        state: "failed",
        errorCode: result?.error.code ?? "IO_ERROR",
        retryable: result?.error.retryable ?? true,
      },
    });
    publish(chatId, { ...current, selections });
    return;
  }
  const attachmentId = `gallery_${selectionToken.replaceAll("-", "")}`;
  selections.set(item.logicalKey, {
    ...selected,
    materialization: "done",
    // sourceRef 保留 owner-native attachmentId；Composer id 只代表本次 occurrence，
    // 否则两个 row 指向同一 blob 时会在 freeze 才因内容级 id 重复而失败。
    attachmentId,
    sourceRevision: result.value.sourceRevision,
    materializationToken: result.value.materializationToken,
  });
  publish(chatId, { ...current, selections });
  const file: ComposerFile = {
    id: attachmentId,
    type: "file",
    filename: result.value.filename,
    mediaType: result.value.mediaType,
    url: result.value.dataUrl,
    origin: {
      kind: "gallery",
      logicalKey: item.logicalKey,
      sourceRevision: result.value.sourceRevision,
      selectionToken,
      materializationToken: result.value.materializationToken,
    },
  };
  const draft = readComposer(chatId).draft.files;
  replaceDraftFiles(chatId, [
    ...draft.filter(
      (candidate) => candidate.origin?.logicalKey !== item.logicalKey
    ),
    file,
  ]);
}

export function saveGalleryComment(
  chatId: string,
  item: Extract<GalleryItem, { phase: "ready" }>,
  input: { id?: string; x: number; y: number; text: string }
) {
  const state = read(chatId);
  if (!state.selections.has(item.logicalKey)) {
    assertSelectionCapacity(
      chatId,
      new Map(state.selections),
      item.logicalKey
    );
  }
  const comments = new Map(state.comments);
  const current = comments.get(item.logicalKey) ?? [];
  const existing = input.id
    ? current.find((comment) => comment.id === input.id)
    : undefined;
  const next: GalleryComment = {
    id: existing?.id ?? crypto.randomUUID(),
    version: (existing?.version ?? 0) + 1,
    x: Math.min(1, Math.max(0, input.x)),
    y: Math.min(1, Math.max(0, input.y)),
    text: input.text.trim(),
  };
  // 额度双点预检的添加点：全部评论文本合计 ≤32KB（提交点在 freezeGalleryDraft 复核含用户原文的总量）
  const commentBytes = [...comments.values()]
    .flat()
    .filter((comment) => comment.id !== next.id)
    .concat(next)
    .reduce(
      (total, comment) =>
        total + new TextEncoder().encode(comment.text).length,
      0
    );
  if (commentBytes > 32 * 1024) {
    throwGalleryError("COMMENT_TEXT_LIMIT", "评论文本合计超出 32KB");
  }
  comments.set(
    item.logicalKey,
    existing
      ? current.map((comment) => (comment.id === existing.id ? next : comment))
      : [...current, next]
  );
  publish(chatId, { ...state, comments });
  if (!state.selections.has(item.logicalKey)) {
    void selectGalleryItem(chatId, item, true);
  }
}

export function deleteGalleryComment(
  chatId: string,
  logicalKey: string,
  commentId: string
) {
  const state = read(chatId);
  const comments = new Map(state.comments);
  const next = (comments.get(logicalKey) ?? []).filter(
    (comment) => comment.id !== commentId
  );
  if (next.length) comments.set(logicalKey, next);
  else comments.delete(logicalKey);
  publish(chatId, { ...state, comments });
}

export function clearGalleryComments(chatId: string) {
  const state = read(chatId);
  publish(chatId, { ...state, comments: new Map() });
}

export function gallerySendGate(chatId: string) {
  return [...read(chatId).selections.values()].some(
    (selection) => selection.materialization !== "done"
  );
}

export function applyGalleryAttachmentCommand(
  chatId: string,
  command: AttachmentCommand
) {
  const state = read(chatId);
  const selections = new Map(state.selections);
  const comments = new Map(state.comments);
  const desiredItems = new Set(state.desiredItems);
  let changed = false;
  for (const target of command.targets) {
    const logicalKey = target.gallery?.logicalKey;
    if (!logicalKey) continue;
    const selection = selections.get(logicalKey);
    if (!selection || !targetMatchesSelection(selection, target)) continue;
    if (command.type === "capability-suspend") {
      selections.set(logicalKey, {
        ...selection,
        selectionToken: crypto.randomUUID(),
        materialization: "suspended",
      });
      changed = true;
      continue;
    }
    selections.delete(logicalKey);
    desiredItems.delete(logicalKey);
    changed = true;
    if (
      command.type === "user-remove" ||
      command.type === "source-gone" ||
      command.type === "submit-consume"
    ) {
      comments.delete(logicalKey);
    }
  }
  if (changed) {
    publish(chatId, { ...state, selections, comments, desiredItems });
  }
}

export async function resumeGalleryAfterCapability(chatId: string) {
  const state = read(chatId);
  if (!state.imageInputAvailable) return;
  const suspended = [...state.selections.values()].filter(
    (selection) => selection.materialization === "suspended"
  );
  for (const selection of suspended) {
    // 单项失败（限额/瞬时锁）不阻断其余恢复，也不向 void 调用方泄漏 rejection
    try {
      await selectGalleryItem(
        chatId,
        {
          phase: "ready",
          id: galleryOccurrenceKey(selection.sourceRef),
          logicalKey: selection.logicalKey,
          occurredAt: 0,
          rowId:
            selection.sourceRef.kind === "attachment"
              ? selection.sourceRef.rowId
              : "running",
          sourceRef: selection.sourceRef,
        },
        true
      );
    } catch {
      // 保持 suspended 原状，用户可手动重选
    }
  }
}

export function suspendGalleryForCapability(chatId: string) {
  const state = read(chatId);
  const targets = [...state.selections.values()]
    .filter((selection) => selection.materialization !== "suspended")
    .map(selectionTarget);
  if (!targets.length) return;
  const command: AttachmentCommand = {
    type: "capability-suspend",
    targets,
  };
  applyGalleryAttachmentCommand(chatId, command);
  replaceDraftFiles(
    chatId,
    readComposer(chatId).draft.files.filter(
      (file) =>
        !targets.some((target) => attachmentMatchesTarget(file, target))
    )
  );
}

export function reconcileGallerySources(
  chatId: string,
  currentLogicalKeys: ReadonlySet<string>
) {
  const state = read(chatId);
  const stale = [...state.selections.values()].filter(
    (selection) => !currentLogicalKeys.has(selection.logicalKey)
  );
  const targets = stale.map(selectionTarget);
  if (targets.length) {
    applyGalleryAttachmentCommand(chatId, {
      type: "source-gone",
      targets,
    });
    replaceDraftFiles(
      chatId,
      readComposer(chatId).draft.files.filter(
        (file) =>
          !targets.some((target) => attachmentMatchesTarget(file, target))
      )
    );
  }
  const current = read(chatId);
  const orphanComments = [...current.comments.keys()].filter(
    (logicalKey) => !currentLogicalKeys.has(logicalKey)
  );
  if (orphanComments.length) {
    const comments = new Map(current.comments);
    for (const logicalKey of orphanComments) comments.delete(logicalKey);
    publish(chatId, { ...current, comments });
  }
}

/**
 * completion receipt 把 transcript overlay 的临时身份折叠到 durable row 身份。
 * selection/comment/desired 与已物化 Composer file 同步换 key；旧 key 不留第二份状态。
 */
export function migrateGalleryIdentity(
  chatId: string,
  fromLogicalKey: string,
  item: Extract<GalleryItem, { phase: "ready" }>
) {
  if (fromLogicalKey === item.logicalKey) return;
  const state = read(chatId);
  const selections = new Map(state.selections);
  const comments = new Map(state.comments);
  const desiredItems = new Set(state.desiredItems);
  const previous = selections.get(fromLogicalKey);
  const destination = selections.get(item.logicalKey);
  let rematerializeToken: string | undefined;
  if (previous) {
    selections.delete(fromLogicalKey);
    if (!destination) {
      if (previous.materialization === "pending") {
        rematerializeToken = crypto.randomUUID();
        selections.set(item.logicalKey, {
          logicalKey: item.logicalKey,
          sourceRef: item.sourceRef,
          selectionToken: rematerializeToken,
          materialization: "pending",
        });
      } else {
        selections.set(item.logicalKey, {
          ...previous,
          logicalKey: item.logicalKey,
          sourceRef: item.sourceRef,
        });
      }
    }
  }
  const previousComments = comments.get(fromLogicalKey);
  if (previousComments) {
    comments.delete(fromLogicalKey);
    const merged = new Map(
      (comments.get(item.logicalKey) ?? []).map((comment) => [
        comment.id,
        comment,
      ])
    );
    for (const comment of previousComments) merged.set(comment.id, comment);
    comments.set(item.logicalKey, [...merged.values()]);
  }
  if (desiredItems.delete(fromLogicalKey)) desiredItems.add(item.logicalKey);
  if (previous || previousComments || state.desiredItems.has(fromLogicalKey)) {
    publish(chatId, { ...state, selections, comments, desiredItems });
  }
  const draft = readComposer(chatId).draft.files;
  if (
    draft.some(
      (file) =>
        file.origin?.kind === "gallery" &&
        file.origin.logicalKey === fromLogicalKey
    )
  ) {
    replaceDraftFiles(
      chatId,
      draft.flatMap((file) => {
        if (
          file.origin?.kind !== "gallery" ||
          file.origin.logicalKey !== fromLogicalKey
        ) {
          return [file];
        }
        return destination
          ? []
          : [{
              ...file,
              origin: { ...file.origin, logicalKey: item.logicalKey },
            }];
      })
    );
  }
  if (rematerializeToken) {
    // receipt 到达即令旧 token/key 失效，并从 owner-native durable source 重取；
    // 旧 transcript 回包随后只能命中已删除的 fromLogicalKey，无法污染 Composer。
    void finishMaterialization(chatId, item, rematerializeToken);
  }
}

export function expireGallerySource(chatId: string, logicalKey: string) {
  const state = read(chatId);
  const selection = state.selections.get(logicalKey);
  const targets = selection ? [selectionTarget(selection)] : [];
  if (targets.length) {
    applyGalleryAttachmentCommand(chatId, {
      type: "source-gone",
      targets,
    });
    replaceDraftFiles(
      chatId,
      readComposer(chatId).draft.files.filter(
        (file) =>
          !targets.some((target) => attachmentMatchesTarget(file, target))
      )
    );
  }
  const current = read(chatId);
  if (!current.comments.has(logicalKey)) return;
  const comments = new Map(current.comments);
  comments.delete(logicalKey);
  publish(chatId, { ...current, comments });
}

function retainComposerFiles(chatId: string, logicalKeys: ReadonlySet<string>) {
  replaceDraftFiles(
    chatId,
    readComposer(chatId).draft.files.filter(
      (file) =>
        file.origin?.kind !== "gallery" ||
        logicalKeys.has(file.origin.logicalKey)
    )
  );
}

function selectionTarget(
  selection: GallerySelection
): AttachmentCommandTarget {
  return {
    ...(selection.attachmentId
      ? { attachmentId: selection.attachmentId }
      : {}),
    gallery: {
      kind: "gallery",
      logicalKey: selection.logicalKey,
      selectionToken: selection.selectionToken,
      ...(selection.sourceRevision
        ? { sourceRevision: selection.sourceRevision }
        : {}),
      ...(selection.materializationToken
        ? { materializationToken: selection.materializationToken }
        : {}),
    },
  };
}

function targetMatchesSelection(
  selection: GallerySelection,
  target: AttachmentCommandTarget
) {
  const gallery = target.gallery;
  if (
    !gallery ||
    gallery.logicalKey !== selection.logicalKey ||
    gallery.selectionToken !== selection.selectionToken
  ) {
    return false;
  }
  if (target.attachmentId && target.attachmentId !== selection.attachmentId) {
    return false;
  }
  if (
    gallery.sourceRevision &&
    gallery.sourceRevision !== selection.sourceRevision
  ) {
    return false;
  }
  return (
    !gallery.materializationToken ||
    gallery.materializationToken === selection.materializationToken
  );
}

function assertSelectionCapacity(
  chatId: string,
  retained: ReadonlyMap<string, GallerySelection>,
  logicalKey: string
) {
  const composer = readComposer(chatId).draft;
  const galleryCount = retained.has(logicalKey)
    ? retained.size
    : retained.size + 1;
  const manualFiles = composer.files.filter(
    (file) => file.origin?.kind !== "gallery"
  ).length;
  const richFiles = composer.richValue.filter(
    (node) => node.type === "file"
  ).length;
  if (manualFiles + richFiles + galleryCount > ATTACHMENT_LIMIT) {
    throwGalleryError("ATTACHMENT_LIMIT", "附件最多 8 个");
  }
  if (
    projectRichInput(composer.richValue).length +
      manualFiles +
      galleryCount >
    AGENT_INPUT_LIMIT
  ) {
    throwGalleryError("AGENT_INPUT_LIMIT", "消息结构项最多 32 个");
  }
}

function throwGalleryError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export function resetGalleryStoreForTests() {
  entries.clear();
  listeners.clear();
}
