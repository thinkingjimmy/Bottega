/**
 * [INPUT]: Depends on Node fs/path, zod, shared Agent/Settings IPC, Memory registry, durable persistence, and SerialQueue
 * [OUTPUT]: Provides SettingsStore v11, strict per-scope options, scope-only CAS adoption seeding, global defaults, locale/theme/tools/shortcuts, Skills-onboarding state, Memory control, and fail-closed recovery
 * [POS]: The canonical multi-backend settings owner in Electron main
 */

import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import type {
  AgentBackendId,
  AgentScope,
  AgentTurnOptions,
  CodexTurnOptions,
} from "../../shared/agent-ipc";
import { agentBackendIdSchema } from "../../shared/agent-schema";
import {
  MEMORY_SHARING_MODES,
  type AppSettings,
  type MemorySettings,
  type SettingsEnvelope,
} from "../../shared/settings-ipc";
import { THEME_PREFERENCES } from "../../shared/settings-ipc";
import { LANGUAGE_PREFERENCES } from "../../shared/i18n/locale";
import {
  DEFAULT_MEMORY_PROVIDER_ID,
  MEMORY_PROVIDER_IDS,
} from "./memory/providers/registry";
import { SerialQueue } from "./persistence/serial-queue";
import { OPAQUE_CONFIG_VALUE_PATTERN } from "./backends/capability-validation";

const SCHEMA_VERSION = 11;
export const DEFAULT_CHAT_OPTIONS: CodexTurnOptions = {
  backend: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
  serviceTier: "priority",
  permissionMode: "approve-for-me",
};
export const DEFAULT_CHAT_OPTIONS_BY_BACKEND: AppSettings["defaultChatOptionsByBackend"] = {
  codex: DEFAULT_CHAT_OPTIONS,
  claude: { backend: "claude", permissionMode: "ask-for-approval" },
  kimi: { backend: "kimi", permissionMode: "ask-for-approval" },
  opencode: { backend: "opencode", permissionMode: "ask-for-approval" },
};
const DEFAULT_SETTINGS: AppSettings = {
  chatHomesRoot: null,
  chatHomeState: "unconfigured",
  allowCrossChatRead: false,
  disabledBuiltinTools: [],
  fullAccessAcknowledgedAt: null,
  theme: "auto",
  language: "auto",
  titleAgent: "auto",
  titleModelByBackend: { codex: null },
  defaultChatOptionsByBackend: DEFAULT_CHAT_OPTIONS_BY_BACKEND,
  lastSelectedBackend: "codex",
  autoRelayLimit: 25,
  usagePricingAutoRefresh: true,
  skillsOnboarding: "pending",
  keyboardShortcuts: {},
  memory: {
    enabled: false,
    paused: false,
    provider: DEFAULT_MEMORY_PROVIDER_ID,
    sharingMode: "chat",
    pendingRevision: null,
    applyStatus: null,
  },
};

const optionValue = z.string().trim().min(1).max(200);
/* Opaque backend config values are never normalized: persistence must preserve
   the exact catalog value, including leading/trailing printable spaces. */
const opaqueConfigValue = z
  .string()
  .min(1)
  .max(200)
  .regex(OPAQUE_CONFIG_VALUE_PATTERN);
const permissionMode = z.enum([
  "ask-for-approval",
  "approve-for-me",
  "full-access",
]);
const codexOptionsSchema = z
  .object({
    backend: z.literal("codex"),
    model: optionValue,
    reasoningEffort: opaqueConfigValue,
    serviceTier: opaqueConfigValue,
    permissionMode,
  })
  .strict();
const claudeOptionsSchema = z
  .object({
    backend: z.literal("claude"),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    serviceTier: opaqueConfigValue.optional(),
    permissionMode,
  })
  .strict();
const kimiOptionsSchema = z
  .object({
    backend: z.literal("kimi"),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    permissionMode,
  })
  .strict();
/* OpenCode 的 effort 随模型 variants 浮动：无 variants 的模型在 wire 上
   没有 effort 配置项，故字段可选——缺省即交回 CLI 自己决定。 */
const opencodeOptionsSchema = z
  .object({
    backend: z.literal("opencode"),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    permissionMode,
  })
  .strict();
const turnOptionsSchema = z.discriminatedUnion("backend", [
  codexOptionsSchema,
  claudeOptionsSchema,
  kimiOptionsSchema,
  opencodeOptionsSchema,
]);
const backendSchema = agentBackendIdSchema;
const defaultsSchema = z
  .object({
    codex: codexOptionsSchema.optional(),
    claude: claudeOptionsSchema.optional(),
    kimi: kimiOptionsSchema.optional(),
    opencode: opencodeOptionsSchema.optional(),
  })
  .strict();
/* 断代收窄：migrating/failed 只由已删除的迁移产生。旧档若还带着这两个值，
   经由既有 backupInvalid 路径 fail closed——备份后拒载，不做读时升格。 */
const chatHomeStateSchema = z.enum(["unconfigured", "ready"]);

/** provider enum 由注册表派生：新增插件不必回到本文件改 enum。 */
const memoryProviderIdSchema = z
  .string()
  .refine((value) => MEMORY_PROVIDER_IDS.includes(value), {
    message: "未知的 Memory provider",
  });

const memorySchema = z
  .object({
    enabled: z.boolean(),
    paused: z.boolean(),
    provider: memoryProviderIdSchema,
    sharingMode: z.enum(MEMORY_SHARING_MODES),
    pendingRevision: z.number().int().nonnegative().nullable(),
    applyStatus: z
      .object({
        state: z.enum(["pending", "failed"]),
        message: z.string().max(2_000).nullable(),
        at: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/* key 存 event.key.toLowerCase()：单字符或 "f12"，8 位封顶足矣。 */
const shortcutBindingSchema = z
  .object({ key: z.string().min(1).max(8), shift: z.boolean() })
  .strict();

const settingsSchema = z
  .object({
    chatHomesRoot: z
      .string()
      .min(1)
      .max(1024)
      .refine(isAbsolute, "Chat Home 存放位置必须是绝对路径")
      .nullable(),
    chatHomeState: chatHomeStateSchema,
    allowCrossChatRead: z.boolean(),
    /* 工具名故意不做 enum：删除/改名工具不会把既有设置档变成炸弹。 */
    disabledBuiltinTools: z
      .array(z.string().min(1).max(64))
      .max(64)
      .default([]),
    fullAccessAcknowledgedAt: z.number().int().nonnegative().nullable(),
    /* theme 带 .default 而不是必填，是唯一能加的写法：settingsSchema 是
       .strict() 且全字段必填，多一个无默认值的键会让每一份既有 settings.json
       当场解析失败、fail-closed 打死整个 app。给了默认值，旧档缺键即补 auto，
       .strict() 仍然挡未知键——于是不必 bump SCHEMA_VERSION。 */
    theme: z.enum(THEME_PREFERENCES).default("auto"),
    /* 与 theme 同为 additive default：旧 v10 缺键时仍可直接读。 */
    language: z.enum(LANGUAGE_PREFERENCES).default("auto"),
    titleAgent: z.union([backendSchema, z.literal("auto")]),
    titleModelByBackend: z
      .object({
        codex: optionValue.nullable().optional(),
        claude: optionValue.nullable().optional(),
        kimi: optionValue.nullable().optional(),
        opencode: optionValue.nullable().optional(),
      })
      .strict(),
    defaultChatOptionsByBackend: defaultsSchema,
    lastSelectedBackend: backendSchema,
    autoRelayLimit: z.number().int().min(0).max(1_000),
    usagePricingAutoRefresh: z.boolean(),
    /* Additive default keeps existing strict settings files readable. */
    skillsOnboarding: z.enum(["pending", "done", "skipped"]).default("pending"),
    /* 快捷键覆写刻意不对称：id 键宽松（同 disabledBuiltinTools——删除/
       改名快捷键不把旧档变炸弹，消费侧与默认表求交），binding 值仍
       strict——畸形 value 与其它字段一样 fail-closed，别「修」掉这一半。
       additive .default({})：旧档缺键即补空，不 bump SCHEMA_VERSION。 */
    keyboardShortcuts: z
      .record(z.string().min(1).max(64), shortcutBindingSchema.nullable())
      .refine((value) => Object.keys(value).length <= 64, {
        message: "快捷键覆写数量超限",
      })
      .default({}),
    memory: memorySchema,
  })
  .strict();
const scopeKeySchema = z
  .string()
  .regex(/^(general:[A-Za-z0-9_-]{1,128}|app:[a-z0-9]{10})$/);
const settingsFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** 单调 revision：renderer 的 mutation queue 按它 rebase。 */
    revision: z.number().int().nonnegative(),
    settings: settingsSchema,
    chatOptionsByScope: z.record(scopeKeySchema, turnOptionsSchema),
  })
  .strict();
type SettingsFile = z.infer<typeof settingsFileSchema>;

export function chatScopeKey(scope: AgentScope) {
  return scopeKeySchema.parse(`general:${scope.conversationId}`);
}

function optionsForNextConversation(options: AgentTurnOptions) {
  if (
    options.backend !== "claude" ||
    options.reasoningEffort !== "max"
  ) {
    return options;
  }
  const defaults = { ...options };
  delete defaults.reasoningEffort;
  return defaults;
}

function parseFile(value: unknown): SettingsFile {
  return settingsFileSchema.parse(value);
}

export class SettingsStore {
  readonly filePath: string;
  private readonly queue = new SerialQueue();
  private state: SettingsFile = {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    settings: structuredClone(DEFAULT_SETTINGS) as SettingsFile["settings"],
    chatOptionsByScope: {},
  };
  private readonly watchers = new Set<(envelope: SettingsEnvelope) => void>();

  constructor(userData: string) {
    this.filePath = join(userData, "settings.json");
  }

  async initialize() {
    await this.queue.enqueue(async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(this.filePath, "utf8"));
      } catch (cause) {
        if (
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          await this.persist(this.state);
          return;
        }
        await this.backupInvalid().catch(() => {});
        throw new Error("settings.json 损坏，已保留备份并停止加载", {
          cause,
        });
      }
      let next: SettingsFile;
      try {
        if (isSettingsV10(raw)) {
          await copyFile(this.filePath, `${this.filePath}.memory-sharing-v10.bak`);
          const candidate = raw as Record<string, unknown>;
          const settings = candidate.settings as Record<string, unknown>;
          const previousMemory = settings.memory as Record<string, unknown>;
          const provider = memoryProviderIdSchema.safeParse(
            previousMemory.provider
          );
          next = parseFile({
            ...candidate,
            schemaVersion: SCHEMA_VERSION,
            settings: {
              ...settings,
              memory: {
                ...structuredClone(DEFAULT_SETTINGS.memory),
                ...(provider.success ? { provider: provider.data } : {}),
              },
            },
          });
          await this.persist(next);
        /* Memory v2 的 disclosureAccepted 不能升格成 Consent Epoch。开发者
           受核断代只保留非 Memory 设置，并把整个 Memory 域归零；备份是
           审计证据，不是生产 fallback。 */
        } else if (hasLegacyMemoryDomain(raw)) {
          await copyFile(this.filePath, `${this.filePath}.memory-v2.bak`);
          const candidate = raw as Record<string, unknown>;
          next = parseFile({
            ...candidate,
            settings: {
              ...(candidate.settings as Record<string, unknown>),
              memory: structuredClone(DEFAULT_SETTINGS.memory),
            },
          });
          await this.persist(next);
        } else {
          /* v11 是唯一可读版本，未列明版本与未来版本同罪 fail-closed。 */
          next = parseFile(raw);
        }
      } catch (cause) {
        await this.backupInvalid();
        throw new Error("settings.json schema 无效，已保留备份并停止加载", {
          cause,
        });
      }
      this.state = next;
    });
  }

  get() {
    return structuredClone(this.state.settings);
  }

  envelope(): SettingsEnvelope {
    return { revision: this.state.revision, settings: this.get() };
  }

  /** 广播与响应共用同一信封；订阅者只在真正落盘后被唤醒。 */
  onChanged(listener: (envelope: SettingsEnvelope) => void) {
    this.watchers.add(listener);
    return () => {
      this.watchers.delete(listener);
    };
  }

  /** renderer 通用出口：memory 已在 RendererSettingsPatch 与 registrar 双重摘除。 */
  set(patch: Omit<Partial<AppSettings>, "memory">) {
    return this.setTrusted(patch);
  }

  setTrusted(patch: Partial<AppSettings>) {
    return this.queue.enqueue(async () => {
      const settings = settingsSchema.parse({
        ...this.state.settings,
        ...patch,
      });
      await this.commit({ ...this.state, settings });
      return this.envelope();
    });
  }

  /** Memory 域唯一写入口；调用方（Settings Owner）已完成合并与统一校验。 */
  setMemoryTrusted(memory: MemorySettings) {
    return this.setTrusted({ memory });
  }

  acknowledgeFullAccess() {
    return this.setTrusted({ fullAccessAcknowledgedAt: Date.now() });
  }

  resolveChatOptions(scope: AgentScope, backend?: AgentBackendId) {
    return this.queue.enqueue(async () => {
      const key = chatScopeKey(scope);
      const current = this.state.chatOptionsByScope[key];
      if (current && (!backend || current.backend === backend)) {
        return structuredClone(current);
      }
      const selected = backend ?? this.state.settings.lastSelectedBackend;
      const options =
        this.state.settings.defaultChatOptionsByBackend[selected] ??
        DEFAULT_CHAT_OPTIONS_BY_BACKEND[selected];
      if (!options) throw new Error(`${selected} 缺少默认聊天设置`);
      await this.commit({
        ...this.state,
        chatOptionsByScope: {
          ...this.state.chatOptionsByScope,
          [key]: options,
        },
      });
      return structuredClone(options);
    });
  }

  /**
   * 收养换名只转移这一条 scope 的所有权。CAS 保留目标 scope 上已经发生的
   * 用户写入；与 setChatOptions 不同，本事务绝不回灌全局默认或 last backend。
   */
  seedChatOptions(scope: AgentScope, value: AgentTurnOptions) {
    return this.queue.enqueue(async () => {
      const key = chatScopeKey(scope);
      const options = turnOptionsSchema.parse(value);
      if (
        options.permissionMode === "full-access" &&
        this.state.settings.fullAccessAcknowledgedAt === null
      ) {
        throw new Error("FULL_ACCESS_ACK_REQUIRED: 必须先确认 Full Access 风险");
      }
      const current = this.state.chatOptionsByScope[key];
      if (current) {
        return { seeded: false, options: structuredClone(current) } as const;
      }
      await this.commit({
        ...this.state,
        chatOptionsByScope: {
          ...this.state.chatOptionsByScope,
          [key]: options,
        },
      });
      return { seeded: true, options: structuredClone(options) } as const;
    });
  }

  setChatOptions(scope: AgentScope, value: AgentTurnOptions) {
    return this.queue.enqueue(async () => {
      const key = chatScopeKey(scope);
      const options = turnOptionsSchema.parse(value);
      if (
        options.permissionMode === "full-access" &&
        this.state.settings.fullAccessAcknowledgedAt === null
      ) {
        throw new Error("FULL_ACCESS_ACK_REQUIRED: 必须先确认 Full Access 风险");
      }
      const defaults = optionsForNextConversation(options);
      await this.commit({
        ...this.state,
        settings: {
          ...this.state.settings,
          lastSelectedBackend: options.backend,
          defaultChatOptionsByBackend: {
            ...this.state.settings.defaultChatOptionsByBackend,
            [options.backend]: defaults,
          },
        },
        chatOptionsByScope: {
          ...this.state.chatOptionsByScope,
          [key]: options,
        },
      });
      return structuredClone(options);
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private async backupInvalid() {
    await copyFile(this.filePath, `${this.filePath}.invalid.bak`);
  }

  /* 落盘、推 revision、广播——三件事同一处发生。任何绕过 commit 的
     写法都会造出「磁盘变了但没人知道」的静默分叉。 */
  private async commit(next: SettingsFile) {
    const committed: SettingsFile = { ...next, revision: this.state.revision + 1 };
    await this.persist(committed);
    this.state = committed;
    const envelope = this.envelope();
    for (const watcher of this.watchers) watcher(envelope);
  }

  private async persist(state: SettingsFile) {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    const temporaryFile = await open(temporary, "r");
    await temporaryFile.sync();
    await temporaryFile.close();
    await rename(temporary, this.filePath);
    const directoryFile = await open(directory, "r");
    await directoryFile.sync();
    await directoryFile.close();
  }
}

function hasLegacyMemoryDomain(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  if (file.schemaVersion !== SCHEMA_VERSION) return false;
  const settings = file.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return false;
  }
  const memory = (settings as Record<string, unknown>).memory;
  return Boolean(
    memory &&
      typeof memory === "object" &&
      !Array.isArray(memory) &&
      Object.hasOwn(memory, "disclosureAccepted")
  );
}

function isSettingsV10(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  const settings = file.settings;
  return Boolean(
    file.schemaVersion === 10 &&
      settings &&
      typeof settings === "object" &&
      !Array.isArray(settings) &&
      (settings as Record<string, unknown>).memory
  );
}
