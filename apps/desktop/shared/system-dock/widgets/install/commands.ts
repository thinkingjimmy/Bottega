/**
 * [INPUT]: Depends on strict Zod, fixed instance identities and immutable package references.
 * [OUTPUT]: Provides closed Widget install/retry/cancel/operation, uninstall and original-delivery control schemas.
 * [POS]: Trusted Main-window command boundary; no arbitrary package bytes, path, source metadata or data grant crosses this API.
 */
import { z } from "zod";
import { widgetInstanceIdSchema } from "../entry";
const operationId = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const widgetInstallReviewQuerySchema = z
  .object({ itemId: widgetInstanceIdSchema })
  .strict();
export const widgetInstallConfirmSchema = z
  .object({ operationId, reviewId: z.string().regex(/^[a-f0-9]{32}$/) })
  .strict();
export const widgetInstallOperationSchema = z.object({ operationId }).strict();
export const widgetUninstallSchema = z
  .object({
    definitionId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    sourceInstallationId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  })
  .strict();
export const widgetDeliveryControlSchema = z
  .object({
    reference: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    action: z.enum(["retry", "abandon"]),
  })
  .strict();
