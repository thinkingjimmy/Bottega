/**
 * [INPUT]: Depends on zod plus the shared Base row/cell/id schemas and batch budget
 * [OUTPUT]: Provides the strict insert/patch/delete request envelopes with bounded batch sizes and typed parse issues
 * [POS]: Pure schema leaf of apps/base-gui/api; it reads no request stream and performs no mutation
 */

import { z } from "zod";
import {
  BASE_DELETE_LIMIT,
  BASE_ENTITY_ID_PATTERN,
  BASE_INSERT_LIMIT,
} from "../../../../../shared/bases-ipc";
import {
  baseCellValueSchema,
  baseRowSchema,
} from "../../../../../shared/bases-schema";
import { isBaseAttachmentValue } from "../../../../../shared/bases-ipc";

const baseFenceSchema = {
  expectedBaseInstanceId: z.string().min(1).max(256),
  expectedRevision: z.number().int().nonnegative(),
};
const entityIdSchema = z.string().regex(BASE_ENTITY_ID_PATTERN);

export const insertEnvelopeSchema = z
  .object({
    ...baseFenceSchema,
    rows: z.array(baseRowSchema).min(1).max(BASE_INSERT_LIMIT),
  })
  .strict();

export const patchEnvelopeSchema = z
  .object({
    ...baseFenceSchema,
    patches: z
      .array(
        z
          .object({
            rowId: entityIdSchema,
            patch: z.record(entityIdSchema, baseCellValueSchema.nullable()),
          })
          .strict()
      )
      .min(1)
      .max(BASE_INSERT_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    value.patches.forEach((entry, rowIndex) => {
      Object.entries(entry.patch).forEach(([columnId, cell]) => {
        if (cell !== null && isBaseAttachmentValue(cell)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["patches", rowIndex, "patch", columnId],
            message: "attachment_not_allowed",
          });
        }
      });
    });
  });

export const deleteEnvelopeSchema = z
  .object({
    ...baseFenceSchema,
    rowIds: z.array(entityIdSchema).min(1).max(BASE_DELETE_LIMIT),
  })
  .strict();

export function envelopeIssue(issue: {
  path: PropertyKey[];
  code: string;
  message?: string;
}) {
  const [root, rowIndex, values, columnId] = issue.path;
  if (
    (root === "rows" || root === "patches") &&
    typeof rowIndex === "number" &&
    (values === "values" || values === "patch") &&
    typeof columnId === "string"
  ) {
    return {
      rowIndex,
      columnId,
      reason: issue.message === "attachment_not_allowed"
        ? "attachment_not_allowed"
        : issue.code,
    };
  }
  if ((root === "rows" || root === "patches") && typeof rowIndex === "number") {
    return { rowIndex, reason: issue.code };
  }
  return {
    field: issue.path.map(String).join(".").slice(0, 128),
    reason: issue.code,
  };
}
