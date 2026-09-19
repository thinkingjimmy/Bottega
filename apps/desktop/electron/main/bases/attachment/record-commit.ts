/**
 * [INPUT]: Depends on BaseStore's attachment transaction, frozen field baselines, shared validation and verified staged images.
 * [OUTPUT]: Commits a complete record and its image references once, preserving independent concurrent fields.
 * [POS]: Native record mutation kernel; the existing Store publishes rows, history and cloud outbox in one generation.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { BaseRecordCommit } from "@ai-chat/base-ui/attachments/native-images";
import { BASE_ROW_LIMIT, isBaseAttachmentValue, type BaseRow, type BaseSnapshot } from "../../../../shared/bases-ipc";
import { baseRowSchema } from "../../../../shared/bases-schema";
import { validateBaseCell } from "../validation/base-mutation-validation";
import type { BaseStore } from "../base-store";
import { validateStoredRows } from "../base-store-model";
import { imageError, type ReadyImage } from "./image-staging";

export async function commitBaseRecord(store: BaseStore, input: BaseRecordCommit, images: ReadonlyMap<string, ReadyImage>,
  authorize: () => Promise<void>): Promise<{ snapshot: BaseSnapshot; changed: boolean }> {
  let changed = false;
  const result = await store.transactGallery(input.ownerKey, input.ownerInstanceId, async ({ snapshot }) => {
    await authorize();
    const previous = snapshot.rows.find(row => row.id === input.rowId);
    const creating = input.baselineValues === null;
    if (!creating && !previous) throw imageError("record_missing");
    const values: BaseRow["values"] = creating ? {} : { ...previous!.values };
    const columns = new Map(snapshot.meta.columns.map(column => [column.id, column]));
    const originalColumns = new Map(input.columns.map(column => [column.id, column]));
    const rowIds = new Set([...snapshot.rows.map(row => row.id), ...(creating ? [input.rowId] : [])]);
    const persist = new Set<string>();
    for (const [columnId, value] of Object.entries(input.patch)) {
      const column = columns.get(columnId), original = originalColumns.get(columnId);
      if (!column || !original || column.type !== original.type || !isDeepStrictEqual(column.formula, original.formula)) throw imageError("schema_conflict");
      if (column.type === "formula") throw imageError("invalid_record");
      const currentValue = previous?.values[columnId] ?? null;
      if (!creating && !isDeepStrictEqual(currentValue, input.baselineValues![columnId] ?? null) && !isDeepStrictEqual(currentValue, value)) throw imageError("record_conflict");
      const transferId = input.stagedImages[columnId];
      if (transferId) {
        const image = images.get(transferId);
        if (column.type !== "attachment" || !image || !isDeepStrictEqual(image.value, value)) throw imageError("image_transfer_conflict");
        persist.add(transferId);
      } else if (isBaseAttachmentValue(value ?? undefined) && (creating || !isDeepStrictEqual(currentValue, value))) {
        throw imageError("image_transfer_missing");
      }
      if (value === null) delete values[columnId];
      else {
        try { validateBaseCell(column, value, column.type === "attachment" ? "internal" : "external", rowIds); }
        catch { throw imageError("invalid_record"); }
        values[columnId] = structuredClone(value);
      }
    }
    if (Object.keys(input.stagedImages).some(columnId => !(columnId in input.patch))) throw imageError("image_transfer_conflict");
    const row = baseRowSchema.parse({ id: input.rowId, values });
    try { validateStoredRows([row], new Set(columns.keys())); } catch { throw imageError("invalid_record"); }
    if (previous && isDeepStrictEqual(previous, row)) return { mutation: null, result: null };
    if (creating && previous) throw imageError("record_conflict");
    if (creating && snapshot.rows.length >= BASE_ROW_LIMIT) throw imageError("invalid_record");
    // No byte publication is attempted before all field and schema decisions succeed.
    for (const transferId of persist) await images.get(transferId)!.persist();
    await authorize();
    changed = true;
    return { mutation: { meta: { ...snapshot.meta, revision: snapshot.meta.revision + 1 },
      rows: creating ? [...snapshot.rows, row] : snapshot.rows.map(current => current.id === row.id ? row : current),
      changedRowIds: new Set([row.id]), actor: "renderer", operation: "record-save", syncIntent: { atomicGroup: randomUUID() } }, result: null };
  });
  return { snapshot: result.snapshot, changed };
}
