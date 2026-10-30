/**
 * [INPUT]: Depends on strict local Widget scope, immutable desired item snapshots and exact package source/reference identities.
 * [OUTPUT]: Provides bounded installation confirmations, original operation targets and recoverable installation and local uninstall commit/result schemas.
 * [POS]: Local-only installation journal; synchronized desired state and instance data permissions remain separate owners.
 */
import { z } from "zod";
import {widgetNameSchema} from "@bottega/contracts/plugins/dock/settings";
import {
  localWidgetScopeSchema,
  customWidgetItemSchema,
} from "../../store/custom/model";
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/),
  id = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
export const installSubjectSchema = z
  .object({ definitionId: id, sourceInstallationId: id })
  .strict();
export const installTargetSchema = z
  .object({
    item: customWidgetItemSchema,
    expectedRevision: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const installationSchema = z
  .object({
    scope: localWidgetScopeSchema,
    subject: installSubjectSchema,
    reference: digest,
    generationId: id,
    contractDigest: digest,
    operationId: id,
    name:widgetNameSchema,
  confirmedAt: z.number().int().nonnegative(),
  })
  .strict();
export const installOperationSchema = z
  .object({
    scope: localWidgetScopeSchema,
    operationId: id,
    reviewId: z.string().regex(/^[a-f0-9]{32}$/),
    subject: installSubjectSchema,
    reference: digest,
    generationId: id,
    contractDigest: digest,
    targets: z.array(installTargetSchema).max(100),
    phase: z.enum([
      "confirmed",
      "committing",
      "installed",
      "failed",
      "conflict",
      "cancelled",
    ]),
    itemIds: z.array(id).max(100),
    needsSetup: z.array(id).max(100),
  })
  .strict();
export const uninstallOperationSchema=z.object({scope:localWidgetScopeSchema,operationId:id,reviewId:z.string().regex(/^[a-f0-9]{32}$/),subject:installSubjectSchema,phase:z.enum(['prepared','completed']),confirmations:z.array(z.object({reference:digest,operationId:id}).strict()).max(32),targets:z.array(z.object({item:customWidgetItemSchema,mappingRevision:z.number().int().nonnegative().nullable()}).strict()).max(100)}).strict();
export const installLedgerSchema = z
  .object({
    version: z.literal(1),
    confirmations: z.array(installationSchema).max(32),
    uninstalls:z.array(uninstallOperationSchema).max(256).default([]),
    operations: z.array(installOperationSchema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.operations.map((value) => value.operationId)).size !==
      value.operations.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate installation operation",
      });
    if (
      value.operations.filter(
        (value) => value.phase === "confirmed" || value.phase === "committing",
      ).length > 8
    )
      context.addIssue({
        code: "custom",
        message: "Pending installation capacity exceeded",
      });
  });
export type InstallOperation = z.infer<typeof installOperationSchema>;

export type InstallationRecord=z.infer<typeof installationSchema>;

export type UninstallOperation=z.infer<typeof uninstallOperationSchema>;
