/**
 * [INPUT]: Depends on strict full Widget subjects, opaque Main review tokens and original operation identities.
 * [OUTPUT]: Provides closed WidgetLifecycleControl/Result and pathless local uninstall impact/results.
 * [POS]: Main-window lifecycle confirmation boundary; a renderer cannot replace the reviewed subject or choose cleanup paths.
 */
import { z } from "zod";
import { widgetUninstallSchema } from "./commands";
const operationId = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  reviewId = z.string().regex(/^[a-f0-9]{32}$/);
export const widgetLifecycleControlSchema = z.discriminatedUnion("kind", [
  widgetUninstallSchema
    .extend({ kind: z.literal("uninstall-review") })
    .strict(),
  z
    .object({ kind: z.literal("uninstall-confirm"), operationId, reviewId })
    .strict(),
  z.object({ kind: z.literal("uninstall-operation"), operationId }).strict(),
  z.object({ kind: z.literal("uninstall-retry"), operationId }).strict(),
  widgetUninstallSchema
    .extend({ kind: z.literal("definition-review") })
    .strict(),
  widgetUninstallSchema.extend({ kind: z.literal("definition-edit") }).strict(),
  widgetUninstallSchema
    .extend({
      kind: z.literal("definition-install-review"),
      reference: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({ kind: z.literal("definition-confirm"), operationId, reviewId })
    .strict(),
  z.object({ kind: z.literal("definition-operation"), operationId }).strict(),
  z.object({ kind: z.literal("definition-retry"), operationId }).strict(),
]);
export type WidgetUninstallReview = {
  reviewId: string;
  name: string;
  definitionId: string;
  sourceInstallationId: string;
  packages: number;
  instances: readonly { id: string; name: string }[];
  pendingOperationId?: string;
};
export type WidgetUninstallResult = {
  operationId: string;
  state: "removed" | "pending" | "conflict";
  definitionId: string;
  sourceInstallationId: string;
};
export type WidgetLifecycleControl = z.infer<
  typeof widgetLifecycleControlSchema
>;
export type WidgetRetirementReview = Omit<
  WidgetUninstallReview,
  "packages" | "pendingOperationId"
>;
export type WidgetRetirementResult = {
  operationId: string;
  state: "removed" | "pending";
  definitionId: string;
  sourceInstallationId: string;
  localComplete: boolean;
};
export type WidgetLifecycleResult =
  | {
      kind: "source-edit";
      target: { chatId: string; sourceInstallationId: string };
    }
  | { kind: "install-review"; review: import("./types").WidgetInstallReview }
  | { kind: "definition-review"; review: WidgetRetirementReview }
  | { kind: "definition-result"; result: WidgetRetirementResult | null }
  | { kind: "uninstall-review"; review: WidgetUninstallReview }
  | { kind: "uninstall-result"; result: WidgetUninstallResult | null };
