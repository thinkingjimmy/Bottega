/**
 * [INPUT]: Depends on shared Base IPC contracts and the preload-injected window.bases bridge
 * [OUTPUT]: Provides single-round-trip Base CRUD/import/export/promotion/attachment APIs with stable error codes
 * [POS]: Sole renderer IPC boundary for src/lib/bases; components never access window.bases directly and translate codes at the view boundary
 */

import type {
  BaseMetaPatch,
  BaseMutationError,
  BaseRow,
  BaseRowPatch,
  BasesBridgeApi,
  BasesEvent,
  ReadAttachmentThumbnailInput,
  PutAttachmentInput,
  ListGalleryEntriesInput,
} from "../../../shared/bases-ipc";

declare global {
  interface Window {
    bases?: BasesBridgeApi;
  }
}

/* ============================================================================
 * 唯一的闸门
 *
 * 这里曾住着一整套内存实现：一份 Map、一份 clone、一份 promotion 语义。
 * 它的代价不是那两百行，是每个函数都因此长出「有桥/没桥」两条路，而没桥
 * 的那条永远追不上主进程的真相——CAS 是假的、事件是假的、测试却全绿。
 * 应用只在 Electron 里跑，preload 缺席不是降级模式，是装配错误，故只有
 * 一句话：说出装配错了，然后停下。
 * ========================================================================== */
function bridge(): BasesBridgeApi {
  const api = window.bases;
  if (!api) throw new Error("Base bridge unavailable");
  return api;
}

/* 能力缺席（preload 版本落后于渲染层）与桥缺席是两件事：前者可能只少一项，
   故各自给出稳定 code，让视图边界翻成本地化文案，而不是把英文抛给用户。
   附件两条通道以结果值报告失败，导入两条以 rejection 报告——形状不同，
   但 message 一律是机器码本身，没有一个字是给人读的。 */
function capabilityError(code: string) {
  return Object.assign(new Error(code), { code });
}

function capabilityFailure<Code extends "SOURCE_GONE" | "IO_ERROR">(
  code: Code,
  reason: string
) {
  return {
    ok: false as const,
    error: { code, message: reason, retryable: false },
  };
}

export const getBase = async (ownerKey: string) => bridge().get({ ownerKey });

export const ensureBase = async (ownerKey: string) =>
  bridge().ensure({ ownerKey });

export const listRootBases = async () => bridge().listRootBases();

export const listProjectBases = async () => bridge().listProjectBases();

export const removeManagedBase = async (input: {
  ownerKey: string;
  ownerInstanceId: string;
}) => bridge().removeManaged(input);

export const resolveBaseForSection = async (sectionId: string) =>
  bridge().resolveForSection({ sectionId });

export const promoteBaseToProject = async (input: {
  chatId: string;
  requestId: string;
}) => bridge().promoteToProject(input);

export async function updateBaseMeta(input: {
  ownerKey: string;
  expectedRevision: number;
  patch: BaseMetaPatch;
  surfaceLeaseId?: string;
}) {
  const result = await bridge().updateMeta(input);
  if (!result.ok) throwMutationError(result.error);
  return result.snapshot;
}

export const insertBaseRows = async (input: {
  ownerKey: string;
  rows: BaseRow[];
  surfaceLeaseId?: string;
}) => bridge().insertRows(input);

export const patchBaseRow = async (input: {
  ownerKey: string;
  rowId: string;
  patch: BaseRowPatch;
  surfaceLeaseId?: string;
}) => bridge().patchRow(input);

export async function deleteBaseRows(input: {
  ownerKey: string;
  rowIds: string[];
  expectedRevision: number;
  surfaceLeaseId?: string;
}) {
  const result = await bridge().deleteRows(input);
  if (!result.ok) throwMutationError(result.error);
  return result.snapshot;
}

export const exportBaseCsv = async (ownerKey: string) =>
  bridge().exportCsv({ ownerKey });

export const exportBaseJson = async (ownerKey: string) =>
  bridge().exportJson({ ownerKey });

export const exportBaseXlsx = async (ownerKey: string) =>
  bridge().exportXlsx({ ownerKey });

export const getBaseRowHistory = async (ownerKey: string, rowId: string) =>
  bridge().rowHistory({ ownerKey, rowId });

export const importBaseJson = async (
  ownerKey: string,
  expectedRevision: number
) => {
  const api = bridge();
  if (!api.importJson) throw capabilityError("json_import_unavailable");
  const result = await api.importJson({ ownerKey, expectedRevision });
  if (!result.ok) throwMutationError(result.error);
  return result.cancelled
    ? { cancelled: true as const }
    : { cancelled: false as const, snapshot: result.snapshot };
};

export const importBaseXlsx = async (
  ownerKey: string,
  expectedRevision: number
) => {
  const api = bridge();
  if (!api.importXlsx) throw capabilityError("xlsx_import_unavailable");
  const result = await api.importXlsx({ ownerKey, expectedRevision });
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

export const readBaseAttachmentThumbnail = async (
  input: ReadAttachmentThumbnailInput
) => {
  const api = bridge();
  return (
    api.readAttachmentThumbnail?.(input) ??
    capabilityFailure("SOURCE_GONE", "attachment_source_unavailable")
  );
};

export async function putBaseAttachment(
  input: PutAttachmentInput & { surfaceLeaseId?: string }
) {
  const api = bridge();
  if (!api.putAttachment) {
    return capabilityFailure("IO_ERROR", "attachment_write_unavailable");
  }
  return api.putAttachment(input);
}

export const listBaseGalleryEntries = async (input: ListGalleryEntriesInput) => {
  const api = bridge();
  return (
    api.listGalleryEntries?.(input) ?? {
      ok: true as const,
      value: { entries: [], galleryGeneration: 0 },
    }
  );
};

export function onBasesEvent(callback: (event: BasesEvent) => void) {
  return bridge().onBasesEvent(callback);
}
