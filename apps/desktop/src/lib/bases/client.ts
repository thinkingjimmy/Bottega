/**
 * [INPUT]: Depends on shared Base IPC contracts, optional preload window.bases, and chats-client identity in browser fallback mode
 * [OUTPUT]: Provides Base CRUD/import/export/promotion/attachment APIs with stable error codes and an in-memory fallback
 * [POS]: Sole renderer IPC boundary for src/lib/bases; components never access window.bases directly and translate codes at the view boundary
 */

import {
  baseNavigationOf,
  ownerFromKey,
  ownerKeyOf,
  type BaseMetaPatch,
  type BaseMutationError,
  type BasePinnedSummary,
  type BasePromotionReceipt,
  type BaseResolvedTarget,
  type BaseRow,
  type BaseRowPatch,
  type BasesBridgeApi,
  type BasesEvent,
  type BaseSnapshot,
  type ReadAttachmentThumbnailInput,
  type PutAttachmentInput,
  type ListGalleryEntriesInput,
} from "../../../shared/bases-ipc";
import { getChat } from "../chats-client";

declare global {
  interface Window {
    bases?: BasesBridgeApi;
  }
}

const memory = new Map<string, BaseSnapshot>();
const listeners = new Set<(event: BasesEvent) => void>();
const clone = <T>(value: T): T => structuredClone(value);

function emit(event: BasesEvent) {
  listeners.forEach((listener) => listener(clone(event)));
}

export const getBase = (ownerKey: string) =>
  window.bases?.get({ ownerKey }) ??
  Promise.resolve(clone(memory.get(ownerKey) ?? null));

export async function ensureBase(ownerKey: string) {
  if (window.bases) return window.bases.ensure({ ownerKey });
  const existing = memory.get(ownerKey);
  if (existing) return clone(existing);
  const owner = ownerFromKey(ownerKey);
  if (owner.kind === "project") {
    throw new Error("浏览器降级模式不能隐式创建 Project Base");
  }
  const chat = await getChat(owner.chatId);
  if (!chat) throw new Error("聊天不存在");
  const snapshot: BaseSnapshot = {
    meta: {
      owner: {
        kind: "chat",
        chatId: chat.id,
        incarnationId: chat.incarnationId,
      },
      ownerInstanceId: chat.incarnationId,
      name: chat.title ?? "Untitled Base",
      pinned: false,
      navigation: { kind: "conversation-contained", chatId: chat.id },
      columns: [],
      views: [
        { id: "table", name: "Table", order: 0, config: { type: "table" } },
      ],
      activeViewId: "table",
      revision: 0,
      rowsGeneration: 0,
    },
    rows: [],
  };
  memory.set(ownerKey, snapshot);
  return clone(snapshot);
}

export async function discardCorruptBase(ownerKey: string) {
  if (window.bases) return window.bases.discardCorrupt({ ownerKey });
  memory.delete(ownerKey);
  return ensureBase(ownerKey);
}

function summaries(predicate: (snapshot: BaseSnapshot) => boolean) {
  return [...memory.values()]
    .filter(predicate)
    .map(({ meta }) => ({
      ownerKey: ownerKeyOf(meta.owner),
      ownerInstanceId: meta.ownerInstanceId,
      name: meta.name,
      revision: meta.revision,
      navigation: baseNavigationOf(meta),
    }));
}

export const listPinnedBases = (): Promise<{
  bases: BasePinnedSummary[];
  warning?: string;
}> =>
  window.bases?.listPinned() ??
  Promise.resolve({ bases: summaries((base) => base.meta.pinned) });

export const listProjectBases = (): Promise<{
  bases: BasePinnedSummary[];
  warning?: string;
}> =>
  window.bases?.listProjectBases() ??
  Promise.resolve({
    bases: summaries((base) => base.meta.owner.kind === "project"),
  });

export async function removeManagedBase(input: {
  ownerKey: string;
  ownerInstanceId: string;
}) {
  if (window.bases) return window.bases.removeManaged(input);
  const current = memory.get(input.ownerKey);
  if (!current || current.meta.ownerInstanceId !== input.ownerInstanceId) {
    return { removed: false };
  }
  memory.delete(input.ownerKey);
  emit({
    type: "removed",
    ownerKey: input.ownerKey,
    ownerInstanceId: input.ownerInstanceId,
  });
  return { removed: true };
}

export async function resolveBaseForSection(
  sectionId: string
): Promise<BaseResolvedTarget> {
  if (window.bases) return window.bases.resolveForSection({ sectionId });
  const chat = await getChat(sectionId);
  if (!chat) throw new Error("聊天不存在");
  const chatKey = `chat:${chat.id}`;
  if (memory.has(chatKey)) {
    return {
      ownerKey: chatKey,
      ownerInstanceId: chat.incarnationId,
      status: "healthy",
    };
  }
  const projectKey = chat.projectId ? `project:${chat.projectId}` : null;
  const project = projectKey ? memory.get(projectKey) : undefined;
  if (project) {
    return {
      ownerKey: projectKey!,
      ownerInstanceId: project.meta.ownerInstanceId,
      status: "healthy",
    };
  }
  return {
    ownerKey: chatKey,
    ownerInstanceId: chat.incarnationId,
    status: "absent",
  };
}

export async function promoteBaseToProject(input: {
  chatId: string;
  requestId: string;
}): Promise<BasePromotionReceipt> {
  if (window.bases) return window.bases.promoteToProject(input);
  const chat = await getChat(input.chatId);
  if (!chat?.projectId) throw new Error("聊天尚未归属 Project");
  const fromKey = `chat:${chat.id}`;
  const toKey = `project:${chat.projectId}`;
  const source = memory.get(fromKey);
  if (!source) throw new Error("聊天没有可提升的 Base");
  const views = clone(source.meta.views);
  const target: BaseSnapshot = {
    ...clone(source),
    meta: {
      ...clone(source.meta),
      owner: { kind: "project", projectId: chat.projectId },
      ownerInstanceId: crypto.randomUUID(),
      views,
      activeViewId: views.some((view) => view.id === source.meta.activeViewId)
        ? source.meta.activeViewId
        : views[0]!.id,
      revision: source.meta.revision + 1,
    },
  };
  memory.delete(fromKey);
  memory.set(toKey, target);
  emit({
    type: "base-moved",
    from: {
      ownerKey: fromKey,
      ownerInstanceId: source.meta.ownerInstanceId,
    },
    to: {
      ownerKey: toKey,
      ownerInstanceId: target.meta.ownerInstanceId,
    },
    revision: target.meta.revision,
    reloadRequired: true,
  });
  return {
    ownerKey: toKey,
    ownerInstanceId: target.meta.ownerInstanceId,
    revision: target.meta.revision,
  };
}

export async function updateBaseMeta(input: {
  ownerKey: string;
  expectedRevision: number;
  patch: BaseMetaPatch;
  surfaceLeaseId?: string;
}) {
  if (window.bases) {
    const { surfaceLeaseId, ...mutation } = input;
    const authorityLeaseId = await window.bases.authorizeMutation({
      ownerKey: input.ownerKey,
      operation: "meta",
      expectedRevision: null,
      ...(surfaceLeaseId ? { surfaceLeaseId } : {}),
    });
    const result = await window.bases.updateMeta({ ...mutation, authorityLeaseId });
    if (!result.ok) throwMutationError(result.error);
    return result.snapshot;
  }
  const current = await ensureBase(input.ownerKey);
  if (current.meta.revision !== input.expectedRevision) {
    throwMutationError({
      code: "revision_conflict",
      message: machineMessage("revision_conflict"),
      currentRevision: current.meta.revision,
    });
  }
  const next = {
    ...current,
    meta: {
      ...current.meta,
      ...clone(input.patch),
      revision: current.meta.revision + 1,
    },
  };
  memory.set(input.ownerKey, next);
  emit({
    type: "base-changed",
    ownerKey: input.ownerKey,
    ownerInstanceId: next.meta.ownerInstanceId,
    revision: next.meta.revision,
    meta: next.meta,
  });
  return clone(next);
}

export async function insertBaseRows(input: {
  ownerKey: string;
  rows: BaseRow[];
  surfaceLeaseId?: string;
}) {
  if (window.bases) {
    const { surfaceLeaseId, ...mutation } = input;
    const authorityLeaseId = await window.bases.authorizeMutation({
      ownerKey: input.ownerKey,
      operation: "row-insert",
      expectedRevision: null,
      ...(surfaceLeaseId ? { surfaceLeaseId } : {}),
    });
    return window.bases.insertRows({ ...mutation, authorityLeaseId });
  }
  const current = await ensureBase(input.ownerKey);
  const byId = new Map(current.rows.map((row) => [row.id, row]));
  const additions = input.rows.filter((row) => !byId.has(row.id));
  if (!additions.length) return current;
  const next = bump(current, [...current.rows, ...clone(additions)]);
  memory.set(input.ownerKey, next);
  emitChanged(input.ownerKey, next, { upserts: additions });
  return clone(next);
}

export async function patchBaseRow(input: {
  ownerKey: string;
  rowId: string;
  patch: BaseRowPatch;
  surfaceLeaseId?: string;
}) {
  if (window.bases) {
    const { surfaceLeaseId, ...mutation } = input;
    const authorityLeaseId = await window.bases.authorizeMutation({
      ownerKey: input.ownerKey,
      operation: "row-patch",
      expectedRevision: null,
      ...(surfaceLeaseId ? { surfaceLeaseId } : {}),
    });
    return window.bases.patchRow({ ...mutation, authorityLeaseId });
  }
  const current = await ensureBase(input.ownerKey);
  const row = current.rows.find((candidate) => candidate.id === input.rowId);
  if (!row) throw new Error("row 不存在");
  const values = { ...row.values };
  Object.entries(input.patch).forEach(([key, value]) => {
    if (value === null) delete values[key];
    else values[key] = value;
  });
  const patched = { ...row, values };
  const next = bump(
    current,
    current.rows.map((candidate) => (candidate.id === row.id ? patched : candidate))
  );
  memory.set(input.ownerKey, next);
  emitChanged(input.ownerKey, next, { upserts: [patched] });
  return clone(next);
}

export async function deleteBaseRows(input: {
  ownerKey: string;
  rowIds: string[];
  expectedRevision: number;
  surfaceLeaseId?: string;
}) {
  if (window.bases) {
    const { surfaceLeaseId, ...mutation } = input;
    const authorityLeaseId = await window.bases.authorizeMutation({
      ownerKey: input.ownerKey,
      operation: "row-delete",
      expectedRevision: null,
      ...(surfaceLeaseId ? { surfaceLeaseId } : {}),
    });
    const result = await window.bases.deleteRows({ ...mutation, authorityLeaseId });
    if (!result.ok) throwMutationError(result.error);
    return result.snapshot;
  }
  const current = await ensureBase(input.ownerKey);
  if (current.meta.revision !== input.expectedRevision) {
    throwMutationError({
      code: "revision_conflict",
      message: machineMessage("revision_conflict"),
      currentRevision: current.meta.revision,
    });
  }
  const ids = new Set(input.rowIds);
  const rows = current.rows.filter((row) => !ids.has(row.id));
  if (rows.length === current.rows.length) return current;
  const next = bump(current, rows);
  memory.set(input.ownerKey, next);
  emitChanged(input.ownerKey, next, { removedRowIds: input.rowIds });
  return clone(next);
}

export const exportBaseCsv = (ownerKey: string) =>
  window.bases?.exportCsv({ ownerKey }) ??
  Promise.resolve({ cancelled: true as const });

export const exportBaseJson = (ownerKey: string) =>
  window.bases?.exportJson({ ownerKey }) ??
  Promise.resolve({ cancelled: true as const });

export const exportBaseXlsx = (ownerKey: string) =>
  window.bases?.exportXlsx({ ownerKey }) ??
  Promise.resolve({ cancelled: true as const });

export const getBaseRowHistory = (ownerKey: string, rowId: string) =>
  window.bases?.rowHistory({ ownerKey, rowId }) ??
  Promise.resolve({ entries: [] });

export const importBaseJson = async (
  ownerKey: string,
  expectedRevision: number
) => {
  if (!window.bases) {
    return Promise.reject(
      clientError(
        "json_import_unavailable",
        "json_import_unavailable"
      )
    );
  }
  const authorityLeaseId = await window.bases.authorizeMutation({
    ownerKey,
    operation: "json-import",
    expectedRevision: null,
  });
  const result = await window.bases.importJson({
    ownerKey,
    expectedRevision,
    authorityLeaseId,
  });
  if (!result.ok) throwMutationError(result.error);
  return result.cancelled
    ? { cancelled: true as const }
    : { cancelled: false as const, snapshot: result.snapshot };
};

export const importBaseXlsx = async (
  ownerKey: string,
  expectedRevision: number
) => {
  if (!window.bases) {
    return Promise.reject(
      clientError(
        "xlsx_import_unavailable",
        "xlsx_import_unavailable"
      )
    );
  }
  const authorityLeaseId = await window.bases.authorizeMutation({
    ownerKey,
    operation: "xlsx-import",
    expectedRevision: null,
  });
  const result = await window.bases.importXlsx({
    ownerKey,
    expectedRevision,
    authorityLeaseId,
  });
  if (!result.ok) throwMutationError(result.error);
  return result.cancelled
    ? { cancelled: true as const }
    : {
        cancelled: false as const,
        snapshot: result.snapshot,
        issues: result.issues ?? [],
      };
};

function throwMutationError(error: BaseMutationError): never {
  throw Object.assign(new Error(error.message), error);
}

export const readBaseAttachmentThumbnail = (
  input: ReadAttachmentThumbnailInput
) =>
  window.bases?.readAttachmentThumbnail?.(input) ??
  Promise.resolve({
    ok: false as const,
    error: {
      code: "SOURCE_GONE" as const,
      message: machineMessage("attachment_source_unavailable"),
      retryable: false,
    },
  });

export async function putBaseAttachment(
  input: PutAttachmentInput & { surfaceLeaseId?: string }
) {
  if (!window.bases?.putAttachment) {
    return {
      ok: false as const,
      error: {
        code: "IO_ERROR" as const,
        message: machineMessage("attachment_write_unavailable"),
        retryable: false,
      },
    };
  }
  const { surfaceLeaseId, ...upload } = input;
  const authorityLeaseId = await window.bases.authorizeMutation({
    ownerKey: upload.ownerKey,
    operation: "attachment-put",
    expectedRevision: upload.expectedRevision ?? null,
    ...(surfaceLeaseId ? { surfaceLeaseId } : {}),
  });
  return window.bases.putAttachment({ ...upload, authorityLeaseId });
}

export const listBaseGalleryEntries = (input: ListGalleryEntriesInput) =>
  window.bases?.listGalleryEntries?.(input) ??
  Promise.resolve({
    ok: true as const,
    value: { entries: [], galleryGeneration: 0 },
  });

export function onBasesEvent(callback: (event: BasesEvent) => void) {
  if (window.bases) return window.bases.onBasesEvent(callback);
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function clientError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function machineMessage(code: string) {
  return code;
}

function bump(current: BaseSnapshot, rows: BaseRow[]): BaseSnapshot {
  return {
    ...current,
    meta: {
      ...current.meta,
      revision: current.meta.revision + 1,
      rowsGeneration: current.meta.rowsGeneration + 1,
    },
    rows,
  };
}

function emitChanged(
  ownerKey: string,
  snapshot: BaseSnapshot,
  delta: Pick<
    Extract<BasesEvent, { type: "base-changed" }>,
    "upserts" | "removedRowIds"
  >
) {
  emit({
    type: "base-changed",
    ownerKey,
    ownerInstanceId: snapshot.meta.ownerInstanceId,
    revision: snapshot.meta.revision,
    ...delta,
  });
}
