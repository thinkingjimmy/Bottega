/**
 * [INPUT]: Depends on Node fs/path, zod and normalizeMemoryBaseUrl; Read settings that have been deleted. json v9/v10
 * [OUTPUT]: Provides full v9→v10 validation/migration functions with exclusive backups, double fsync, replace the CLI that is backed up and re-verified
 * [POS]: One-time developer migration tools for scripts; Production SettingsStore continues to fail-closed to non-v10 without the boot time of the boot migration
 */

import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { normalizeMemoryBaseUrl } from "../electron/main/memory/core/provider";

const BACKENDS = ["codex", "claude", "kimi", "opencode"] as const;
const MEMORY_PROVIDERS = ["openviking", "everos"] as const;
const optionValue = z.string().trim().min(1).max(200);
const permissionMode = z.enum([
  "ask-for-approval",
  "approve-for-me",
  "full-access",
]);
const backend = z.enum(BACKENDS);
const codexOptions = z
  .object({
    backend: z.literal("codex"),
    model: optionValue,
    reasoningEffort: optionValue,
    serviceTier: optionValue,
    permissionMode,
  })
  .strict();
const optionalModelOptions = <T extends "claude" | "kimi" | "opencode">(
  id: T
) =>
  z
    .object({
      backend: z.literal(id),
      model: optionValue.optional(),
      reasoningEffort: optionValue.optional(),
      permissionMode,
    })
    .strict();
const claudeOptions = optionalModelOptions("claude");
const kimiOptions = optionalModelOptions("kimi");
const opencodeOptions = optionalModelOptions("opencode");
const turnOptions = z.discriminatedUnion("backend", [
  codexOptions,
  claudeOptions,
  kimiOptions,
  opencodeOptions,
]);
const defaultChatOptions = z
  .object({
    codex: codexOptions.optional(),
    claude: claudeOptions.optional(),
    kimi: kimiOptions.optional(),
    opencode: opencodeOptions.optional(),
  })
  .strict();
const providerId = z.string().refine((value) =>
  MEMORY_PROVIDERS.includes(value as (typeof MEMORY_PROVIDERS)[number])
);
const baseUrl = z.string().transform((value, context) => {
  try {
    return normalizeMemoryBaseUrl(value);
  } catch (cause) {
    context.addIssue({
      code: "custom",
      message: cause instanceof Error ? cause.message : "Memory 服务地址无效",
    });
    return z.NEVER;
  }
});
const applyStatus = z
  .object({
    state: z.enum(["pending", "failed"]),
    message: z.string().max(2_000).nullable(),
    at: z.number().int().nonnegative(),
  })
  .strict()
  .nullable();
const memoryV9 = z
  .object({
    enabled: z.boolean(),
    provider: providerId,
    endpoints: z.record(providerId, baseUrl),
    disclosureAccepted: z.boolean(),
    pendingRevision: z.number().int().nonnegative().nullable(),
    applyStatus,
  })
  .strict();
const memoryV10 = z
  .object({
    enabled: z.boolean(),
    paused: z.boolean(),
    provider: providerId,
    pendingRevision: z.number().int().nonnegative().nullable(),
    applyStatus,
  })
  .strict();

const settings = <T extends z.ZodType>(memory: T) =>
  z
    .object({
      chatHomesRoot: z
        .string()
        .min(1)
        .max(1024)
        .refine(isAbsolute, "Chat Home 存放位置必须是绝对路径")
        .nullable(),
      chatHomeState: z.enum(["unconfigured", "ready"]),
      allowCrossChatRead: z.boolean(),
      disabledBuiltinTools: z.array(z.string().min(1).max(64)).max(64).default([]),
      fullAccessAcknowledgedAt: z.number().int().nonnegative().nullable(),
      theme: z.enum(["auto", "light", "dark"]).default("auto"),
      titleAgent: z.union([backend, z.literal("auto")]),
      titleModelByBackend: z
        .object({
          codex: optionValue.nullable().optional(),
          claude: optionValue.nullable().optional(),
          kimi: optionValue.nullable().optional(),
          opencode: optionValue.nullable().optional(),
        })
        .strict(),
      defaultChatOptionsByBackend: defaultChatOptions,
      lastSelectedBackend: backend,
      autoRelayLimit: z.number().int().min(0).max(1_000),
      usagePricingAutoRefresh: z.boolean(),
      memory,
    })
    .strict();
const scopeKey = z
  .string()
  .regex(/^(general:[A-Za-z0-9_-]{1,128}|app:[a-z0-9]{10})$/);
const envelope = <V extends 9 | 10, T extends z.ZodType>(version: V, memory: T) =>
  z
    .object({
      schemaVersion: z.literal(version),
      revision: z.number().int().nonnegative(),
      settings: settings(memory),
      chatOptionsByScope: z.record(scopeKey, turnOptions),
    })
    .strict();
const settingsV9 = envelope(9, memoryV9);
const settingsV10 = envelope(10, memoryV10);

export function validateSettingsV9(input: unknown) {
  return settingsV9.parse(input);
}

export function validateSettingsV10(input: unknown) {
  return settingsV10.parse(input);
}

export function migrateSettingsV9Document(input: unknown) {
  const legacy = validateSettingsV9(input);
  return validateSettingsV10({
    ...legacy,
    schemaVersion: 10,
    settings: {
      ...legacy.settings,
      memory: {
        enabled: false,
        paused: false,
        provider: "openviking",
        pendingRevision: null,
        applyStatus: null,
      },
    },
  });
}

export async function migrateSettingsV9File(filePath: string) {
  const path = resolve(filePath);
  const source = await readFile(path, "utf8");
  const raw: unknown = JSON.parse(source);
  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw) {
    if ((raw as { schemaVersion?: unknown }).schemaVersion === 10) {
      validateSettingsV10(raw);
      return { migrated: false as const, path, backup: null };
    }
  }

  /* 两个完整信封都在任何落盘前验证：损坏 v9 不创建备份，构造不出合法
     v10 也不触碰原文件。生产 SettingsStore 的 fail-closed 边界保持不变。 */
  const migrated = migrateSettingsV9Document(raw);
  const backup = `${path}.v9.bak`;
  const backupFile = await open(backup, "wx", 0o600);
  try {
    await backupFile.writeFile(source, "utf8");
    await backupFile.sync();
  } finally {
    await backupFile.close();
  }
  await chmod(backup, 0o600);

  const temporary = join(dirname(path), `.settings.${process.pid}.${randomUUID()}.tmp`);
  try {
    const output = `${JSON.stringify(migrated, null, 2)}\n`;
    const temporaryFile = await open(temporary, "wx", 0o600);
    try {
      await temporaryFile.writeFile(output, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }
    await chmod(temporary, 0o600);
    const beforeReplace = validateSettingsV10(
      JSON.parse(await readFile(temporary, "utf8"))
    );
    if (!isDeepStrictEqual(beforeReplace, migrated)) {
      throw new Error("v10 临时文件与待迁移信封不一致");
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    const persisted = validateSettingsV10(JSON.parse(await readFile(path, "utf8")));
    if (!isDeepStrictEqual(persisted, migrated)) {
      throw new Error("v10 replace 后复核不一致，请从排他备份恢复");
    }
    return { migrated: true as const, path, backup };
  } finally {
    await rm(temporary, { force: true });
  }
}

const defaultPath = join(
  homedir(),
  "Library",
  "Application Support",
  "@ai-chat",
  "desktop",
  "settings.json"
);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateSettingsV9File(process.argv[2] ?? defaultPath)
    .then((result) => {
      console.log(
        result.migrated
          ? `ok: v10 written, backup at ${result.backup}`
          : `already valid v10: ${result.path}`
      );
    })
    .catch((cause) => {
      console.error(cause);
      process.exitCode = 1;
    });
}
