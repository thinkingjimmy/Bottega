/**
 * [INPUT]: Depends on exact local account/installation/Library scope and full-source Widget subjects.
 * [OUTPUT]: Provides the original bounded definition retirement journal with terminal local fences and separate remote completion.
 * [POS]: Account-level definition deletion facts; source Projects, Chats and synchronized layout stay with their existing owners.
 */
import { z } from "zod";
import { localWidgetScopeSchema } from "../../store/custom/model";
import { installSubjectSchema } from "../install/model";
export const widgetRetirementSchema = z
  .object({
    scope: localWidgetScopeSchema,
    subject: installSubjectSchema,
    operationId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
    reviewId: z.string().regex(/^[a-f0-9]{32}$/),
    name: z.string().min(1).max(160),
    phase: z.enum(["prepared", "local", "published"]),
    origin: z.enum(["local", "remote"]),
  })
  .strict();
export const widgetDefinitionLedgerSchema = z
  .object({
    version: z.literal(1),
    retirements: z.array(widgetRetirementSchema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.retirements.map((value) => value.operationId)).size !==
      value.retirements.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate definition retirement operation",
      });
  });
export type WidgetRetirement = z.infer<typeof widgetRetirementSchema>;
