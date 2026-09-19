/**
 * [INPUT]: Depends on scoped mutation/media ports and a frozen record draft with staged attachment values.
 * [OUTPUT]: Persists a new record or only changed existing fields using the draft's stable row identity.
 * [POS]: Record commit boundary; verified image references and fields publish through the platform's atomic record port.
 */
import type { BaseRow, BaseRowPatch, BaseSnapshot } from "../../../model/bases-ipc";
import type { BasePlatform } from "../../platform/context";
import { prepareGalleryUpload } from "../../base-workbench-support";
import type { BaseRecordDraft } from "./base-record-editor";
export async function saveBaseRecord(input: { platform: BasePlatform; snapshot: BaseSnapshot; ownerKey: string; surfaceLeaseId?: string;
  values: BaseRow["values"]; draft: BaseRecordDraft;
  messages: { attachmentRequiredMessage: string; unsupportedImageMessage: string; fileReadFailedMessage: string } }) {
  const { platform, ownerKey, surfaceLeaseId, values, draft, snapshot } = input;
  if (draft.scope && (draft.scope.ownerKey !== ownerKey || draft.scope.ownerInstanceId !== snapshot.meta.ownerInstanceId)) throw new Error("base_scope_changed");
  if (platform.mutations.commitRecord) {
    const patch: BaseRowPatch = Object.fromEntries((draft.isNew ? Object.keys(values) : draft.changedColumnIds).map(id => [id, values[id] ?? null]));
    await platform.mutations.commitRecord({ ownerKey, ownerInstanceId: snapshot.meta.ownerInstanceId, surfaceLeaseId: draft.scope?.surfaceLeaseId ?? surfaceLeaseId,
      rowId: draft.rowId, columns: draft.columns, baselineValues: draft.baselineValues, patch });
    return;
  }
  const localFiles = platform.attachments.stageImage ? [] : Object.entries(draft.files);
  let createdByAttachment = false;
  for (const [columnId, file] of localFiles) {
    const upload = await prepareGalleryUpload({ ownerKey, ownerInstanceId: snapshot.meta.ownerInstanceId,
      expectedRevision: snapshot.meta.revision, rowId: draft.rowId, columnId, file, ...input.messages });
    const result = await platform.attachments.putAttachment({ ...upload, surfaceLeaseId });
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    createdByAttachment = draft.isNew;
  }
  if (draft.isNew && !createdByAttachment) {
    await platform.mutations.insertRows(ownerKey, [{ id: draft.rowId, values }], surfaceLeaseId);
  } else {
    const patch: BaseRowPatch = Object.fromEntries(draft.changedColumnIds.filter(id => !localFiles.some(([columnId]) => columnId === id))
      .map(id => [id, values[id] ?? null]));
    if (Object.keys(patch).length) await platform.mutations.patchRow(ownerKey, draft.rowId, patch, surfaceLeaseId);
    else platform.drafts?.cancel();
  }
}
