/**
 * [INPUT]: Depends on zod and Base column/unit strict schema
 * [OUTPUT]: Provides a common App Base data migration v1 contract, schema and type
 * [POS]: The App is a live-Based app that is used to update the appApp packages declare data conversion, platform execution, and prohibit preset exclusive branches
 */

import { z } from "zod";
import { baseCellValueSchema, baseColumnSchema } from "./bases-schema";

const migrationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const columnIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);

const aliasMigrationSchema = z
  .object({
    sourceColumnId: columnIdSchema,
    targetColumnId: columnIdSchema,
    aliases: z.record(z.string().min(1).max(250), z.string().min(1).max(250)),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of Object.keys(value.aliases)) {
      if (key !== normalizeMigrationAlias(key)) {
        context.addIssue({
          code: "custom",
          path: ["aliases", key],
          message: "alias key 必须是 trim + lower-case 后的 canonical 文本",
        });
      }
    }
  });

const appBaseDataMigrationSchema = z
  .object({
    id: migrationIdSchema,
    addColumns: z.array(baseColumnSchema).max(16).default([]),
    defaultValues: z.record(columnIdSchema, baseCellValueSchema).default({}),
    aliases: z.array(aliasMigrationSchema).max(16).default([]),
  })
  .strict();

export const appBaseDataMigrationFileSchema = z
  .object({
    version: z.literal(1),
    migrations: z.array(appBaseDataMigrationSchema).min(1).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, migration] of value.migrations.entries()) {
      if (ids.has(migration.id)) {
        context.addIssue({
          code: "custom",
          path: ["migrations", index, "id"],
          message: `migration id 重复：${migration.id}`,
        });
      }
      ids.add(migration.id);
    }
  });

export type AppBaseDataMigrationFile = z.infer<
  typeof appBaseDataMigrationFileSchema
>;

export function normalizeMigrationAlias(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}
