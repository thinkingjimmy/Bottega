/**
 * [INPUT]: Existing closed Base metadata paths and bounded encrypted-reference scalars.
 * [OUTPUT]: Exact field targets, Base CAS/initial metadata and independently referenced value/baseline/candidate bindings.
 * [POS]: Server-safe field authority and aggregate identity; semantic values stay in client ciphertext.
 */
import { z } from "zod";
import { commitment, digest, id, nullableId, referencesSchema, version } from "./scalars";
const memberId = z.string().regex(/^[A-Za-z0-9_-]+$/).max(128).refine(value => !["__proto__", "constructor", "prototype"].includes(value));
const chartFields = z.enum(["name", "chartType", "dimensionColumnId", "dateBucket", "valueColumnIds", "seriesColumnId",
  "aggregation", "accessibleColors", "filter", "filterScrubbed", "colSpan", "rowSpan"]);
export const columnFieldPathSchema = z.union([
  z.tuple([z.literal("name")]), z.tuple([z.literal("relation"), z.literal("labelColumnId")]),
  z.tuple([z.literal("options"), memberId]), z.tuple([z.literal("options"), memberId, z.enum(["label", "color"])]),
  z.tuple([z.literal("optionsOrder")]),
]);
export const viewFieldPathSchema = z.union([
  z.tuple([z.enum(["name", "order"])]),
  z.tuple([z.literal("config"), z.enum(["filter", "sorts", "visibleColumnIds", "groupByColumnId", "locationColumnId", "labelColumnId",
    "attachmentColumnId", "titleColumnId", "groupByDateColumnId", "dateBucket", "viewFilterScrubbed", "chartsOrder"])]),
  z.tuple([z.literal("config"), z.enum(["columnWidths", "columnAggregations"]), memberId]),
  z.tuple([z.literal("config"), z.literal("charts"), memberId]),
  z.tuple([z.literal("config"), z.literal("charts"), memberId, chartFields]),
]);
export const baseTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cell"), rowId: memberId, columnId: memberId }).strict(),
  z.object({ kind: z.literal("row"), rowId: memberId }).strict(),
  z.object({ kind: z.literal("column"), columnId: memberId }).strict(),
  z.object({ kind: z.literal("column-field"), columnId: memberId, path: columnFieldPathSchema }).strict(),
  z.object({ kind: z.literal("view"), viewId: memberId }).strict(),
  z.object({ kind: z.literal("view-field"), viewId: memberId, path: viewFieldPathSchema }).strict(),
  z.object({ kind: z.literal("order"), field: z.enum(["columns", "views"]) }).strict(),
  z.object({ kind: z.literal("meta"), field: z.enum(["name", "activeViewId"]) }).strict(),
]);
const baseConditionSchema = z.object({ target: baseTargetSchema, version }).strict();
const basePatchMetadataSchema = z.object({ index: version.max(63), kind: z.enum(["set", "unset", "increment", "create-row", "delete-row", "put-column", "set-column-field", "delete-column", "put-view", "set-view-field", "delete-view", "set-order", "set-meta"]),
  target: baseTargetSchema, expectedFieldVersion: version, expectedRowVersion: version.nullable(), expectedColumnSchemaVersion: version.nullable(), references: referencesSchema,
  deletesTarget: z.boolean(), derivedTargets: z.array(baseTargetSchema).max(100), derivedDeletions: z.array(baseTargetSchema).max(32) }).strict()
  .refine(value => ({ set: "cell", unset: "cell", increment: "cell", "create-row": "row", "delete-row": "row", "put-column": "column", "set-column-field": "column-field",
    "delete-column": "column", "put-view": "view", "set-view-field": "view-field", "delete-view": "view", "set-order": "order", "set-meta": "meta" }[value.kind]) === value.target.kind &&
    (!value.derivedTargets.length || value.kind === "delete-column" && value.derivedTargets.every(target => !["cell", "row"].includes(target.kind))) &&
    new Set(value.derivedTargets.map(target => JSON.stringify(target))).size === value.derivedTargets.length &&
    value.derivedDeletions.every(target => target.kind === "view" && value.derivedTargets.some(derived => JSON.stringify(derived) === JSON.stringify(target))) &&
    (value.kind.startsWith("delete-") ? value.deletesTarget : !value.deletesTarget ||
      value.target.kind === "column-field" && value.target.path[0] === "options" && value.target.path.length === 2 ||
      value.target.kind === "view-field" && value.target.path[0] === "config" && value.target.path[1] === "charts" && value.target.path.length === 3));
export const baseOperationMetadataSchema = z.object({ sourceDeviceId: id, actor: z.enum(["user", "agent", "system"]),
  schemaRevision: version, structuralGeneration: version, dependsOnOperationIds: z.array(id).max(1024), atomicGroup: nullableId, batchId: nullableId,
  preconditions: z.array(baseConditionSchema).max(192), patches: z.array(basePatchMetadataSchema).min(1).max(64) }).strict()
  .refine(value => value.patches.every((patch, index) => patch.index === index) && (!value.atomicGroup || value.patches.length <= 32) &&
    new Set(value.dependsOnOperationIds).size === value.dependsOnOperationIds.length &&
    new Set(value.preconditions.map(item => JSON.stringify(item.target))).size === value.preconditions.length &&
    value.patches.every(patch => patch.derivedTargets.every(target => value.preconditions.some(condition => JSON.stringify(condition.target) === JSON.stringify(target)))));
export const baseOperationBindingSchema = z.object({ role: z.enum(["operation", "result", "snapshot"]), schemaRevision: version,
  structuralGeneration: version, metadataCommitment: digest }).strict();
export const baseFieldBindingSchema = z.object({ target: baseTargetSchema, patchIndex: version.max(63), role: z.enum(["value", "baseline", "candidate"]),
  expectedFieldVersion: version, expectedRowVersion: version.nullable(), expectedColumnSchemaVersion: version.nullable(),
  structuralGeneration: version, metadataCommitment: digest }).strict().refine(value => value.target.kind !== "cell" ||
    value.expectedRowVersion !== null && value.expectedColumnSchemaVersion !== null);
export const hashBaseOperationMetadata = (value: z.input<typeof baseOperationMetadataSchema>) => commitment("base-operation", baseOperationMetadataSchema, value);
const baseFieldCipherSchema = z.object({ index: version.max(63), role: z.enum(["value", "baseline", "candidate"]), target: baseTargetSchema,
  references: referencesSchema, ciphertextHash: digest, ciphertextBytes: version.positive().max(98_304) }).strict();
const fieldIdentity = (field: z.infer<typeof baseFieldCipherSchema>) => JSON.stringify([field.index, field.role, field.target]);
const baseCommitMetadataSchema = z.object({ intent: baseOperationMetadataSchema, fields: z.array(baseFieldCipherSchema).max(192) }).strict()
  .refine(value => new Set(value.fields.map(fieldIdentity)).size === value.fields.length && value.fields.every(field => {
    const patch = value.intent.patches[field.index];
    return patch && (JSON.stringify(field.target) === JSON.stringify(patch.target) ||
      patch.kind === "create-row" && patch.target.kind === "row" && field.target.kind === "cell" && patch.target.rowId === field.target.rowId ||
      patch.derivedTargets.some(target => JSON.stringify(target) === JSON.stringify(field.target)));
  }));
export const hashBaseCommitMetadata = (value: z.input<typeof baseCommitMetadataSchema>) => commitment("base-commit", baseCommitMetadataSchema, value);
export const baseAuthorityOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), chatId: id, incarnationId: id }).strict(),
  z.object({ kind: z.literal("project"), projectId: id }).strict(),
]);
const baseAuthorityNavigationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conversation-contained"), chatId: id }).strict(),
  z.object({ kind: z.literal("project-contained"), projectId: id }).strict(),
  z.object({ kind: z.literal("internal-app"), appId: id }).strict(),
  z.object({ kind: z.literal("root-user-managed"), source: z.literal("retained-app-data"), activatedAt: version }).strict(),
]);
export const baseInitialMetadataSchema = z.object({ sourceDeviceId: id, owner: baseAuthorityOwnerSchema, navigation: baseAuthorityNavigationSchema,
  columnIds: z.array(memberId).max(64), viewIds: z.array(memberId).min(1).max(32) }).strict().refine(value =>
  new Set(value.columnIds).size === value.columnIds.length && new Set(value.viewIds).size === value.viewIds.length);
const baseInitialCommitMetadataSchema = z.object({ intent: baseInitialMetadataSchema, fields: z.array(baseFieldCipherSchema).min(4).max(100) }).strict()
  .refine(value => new Set(value.fields.map(fieldIdentity)).size === value.fields.length && value.fields.every(field =>
    field.index === 0 && field.role === "value" && field.references.length === 0 &&
    (field.target.kind === "meta" || field.target.kind === "order" || field.target.kind === "column" && value.intent.columnIds.includes(field.target.columnId) ||
      field.target.kind === "view" && value.intent.viewIds.includes(field.target.viewId))));
export const hashBaseInitialMetadata = (value: z.input<typeof baseInitialMetadataSchema>) => commitment("base-initial", baseInitialMetadataSchema, value);
export const hashBaseInitialCommitMetadata = (value: z.input<typeof baseInitialCommitMetadataSchema>) => commitment("base-initial-commit", baseInitialCommitMetadataSchema, value);
