/**
 * [INPUT]: Depends on canonical Base metadata and the field-version protocol.
 * [OUTPUT]: Constructs the exact empty Base state proven by a successful owner creation transaction.
 * [POS]: Shared initialization kernel; clients may use it only with the original authenticated creation receipt.
 */
import { baseMetaSchema } from "@ai-chat/base-ui/model/bases-schema";
import { validateBaseModel } from "@ai-chat/base-ui/compute/base-mutation-validation";
import type { BaseMergeState } from "./merge";
export function initialBaseState(input: unknown): BaseMergeState {
  const original = baseMetaSchema.parse(input);
  const meta = baseMetaSchema.parse({ ...original, revision: 0, rowsGeneration: 0, galleryGeneration: 0, historyGeneration: 0,
    syncGeneration: undefined, syncHash: undefined });
  validateBaseModel(meta, []);
  return { meta, rows: [], cloudRevision: 0, schemaRevision: 1, rowVersions: {}, tombstones: [],
    columnSchemaVersions: Object.fromEntries(meta.columns.map(column => [column.id, 1])),
    fieldVersions: Object.fromEntries([...meta.columns.map(column => [`column:${column.id}`, 1]), ...meta.views.map(view => [`view:${view.id}`, 1]),
      ["meta:columns", 1], ["meta:views", 1], ["meta:name", 1], ["meta:activeViewId", 1]]) };
}
