/**
 * [INPUT]: Depends on strict full Widget subjects, immutable authenticated deliveries and existing canonical identity hashing.
 * [OUTPUT]: Provides bounded account catalog pages and assertWidgetCatalogPage without installation or data authority.
 * [POS]: Private zero-instance discovery and terminal revocation contract; names and source Chat pointers remain encrypted review content.
 */
import { z } from "zod";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import {
  widgetPackageSubjectSchema,
  widgetPackageDeliverySchema,
  widgetPackageRefSchema,
} from "./model";
export const widgetCatalogEntrySchema = z
  .object({
    accountId: z.string().min(1).max(256),
    subject: widgetPackageSubjectSchema,
    state: z.enum(["active", "revoked"]),
    revision: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    latest: widgetPackageDeliverySchema.nullable(),
    pending:z.array(widgetPackageRefSchema).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.latest &&
      (value.state !== "active" ||
        value.latest.accountId !== value.accountId ||
        canonicalJson(value.latest.subject) !== canonicalJson(value.subject))
    )
      context.addIssue({
        code: "custom",
        message: "Widget catalog source changed",
      });
  });
export const widgetCatalogPageSchema = z
  .object({
    page: z.array(widgetCatalogEntrySchema).max(16),
    continueCursor: z.string().max(8192),
    isDone: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.page.map((entry) => canonicalJson(entry.subject))).size !==
      value.page.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate Widget catalog subject",
      });
  });
export type WidgetCatalogEntry = z.infer<typeof widgetCatalogEntrySchema>;
export type WidgetCatalogPage = z.infer<typeof widgetCatalogPageSchema>;
export function assertWidgetCatalogPage(value: unknown, accountId: string) {
  const page = widgetCatalogPageSchema.parse(value);
  if (page.page.some((entry) => entry.accountId !== accountId))
    throw new Error("WIDGET_CATALOG_ACCOUNT_CHANGED");
  return page;
}
