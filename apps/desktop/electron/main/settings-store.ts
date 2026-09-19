/**
 * [INPUT]: Depends on Node fs/path, zod, shared Agent/Settings IPC, Memory registry, durable persistence, and SerialQueue
 * [OUTPUT]: Provides SettingsStore v11 with additive execution-device, archive-confetti and Agent-connections defaults, the single-backend title Agent that reads a retired or invalid value as the first backend, backend/presence/appearance preferences, Memory control, and fail-closed recovery; Chat options belong to SQLite
 * [POS]: The canonical multi-backend settings owner in Electron main
 */

import { recoverDurableCorruption } from "./persistence/recovery-policy";
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
  AgentTurnOptions,
} from "../../shared/agent-ipc";
import { AGENT_BACKEND_ORDER } from "../../shared/agent-ipc";
import { agentBackendIdSchema } from "../../shared/agent-schema";
import {
  MEMORY_SHARING_MODES,
  type AppSettings,
  type MemorySettings,
  type SettingsEnvelope,
} from "../../shared/settings-ipc";
import { THEME_PREFERENCES } from "../../shared/settings-ipc";
import { LANGUAGE_PREFERENCES } from "@ai-chat/ui/lib/locale";
import {
  DEFAULT_MEMORY_PROVIDER_ID,
  MEMORY_PROVIDER_IDS,
} from "./memory/providers/registry";
import { SerialQueue } from "./persistence/serial-queue";
import { backendDefaults, DEFAULT_CHAT_OPTIONS_BY_BACKEND, defaultsSchema, turnOptionsSchema } from "../../shared/chat-agent/options";
export { DEFAULT_CHAT_OPTIONS, DEFAULT_CHAT_OPTIONS_BY_BACKEND } from "../../shared/chat-agent/options";
const optionValue = z.string().trim().min(1).max(200);
const backendSchema = agentBackendIdSchema;
const DEFAULT_TITLE_AGENT: AgentBackendId = AGENT_BACKEND_ORDER[0];

const SCHEMA_VERSION = 11;
const DEFAULT_SETTINGS: AppSettings = {
  libraryRoot: null,
  libraryId: null,
  chatHomesRoot: null,
  chatHomeState: "unconfigured",
  allowCrossChatRead: false,
  disabledBuiltinTools: [],
  fullAccessAcknowledgedAt: null,
  launchAtLogin: false,
  keepRunningInBackground: false,
  showTaskStatusAtTop: false,
  theme: "auto",
  archiveConfettiEnabled: true,
  agentConnectionsEnabled: false,
  language: "auto",
  titleAgent: DEFAULT_TITLE_AGENT,
  titleModelByBackend: { codex: null },
  defaultChatOptionsByBackend: DEFAULT_CHAT_OPTIONS_BY_BACKEND,
  lastSelectedBackend: "codex",
  defaultExecutionDeviceId: null,
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
    libraryRoot: z.string().min(1).max(4096).refine(isAbsolute).nullable().default(null),
    libraryId: z.string().uuid().nullable().default(null),
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
    launchAtLogin: z.boolean().default(false),
    keepRunningInBackground: z.boolean().default(false),
    showTaskStatusAtTop: z.boolean().default(false),
    theme: z.enum(THEME_PREFERENCES).default("auto"),
    archiveConfettiEnabled: z.boolean().default(true),
    /* Lab switch; additive default keeps existing strict settings files readable. */
    agentConnectionsEnabled: z.boolean().default(false),
    /* 与 theme 同为 additive default：旧档缺键时仍可直接读。 */
    language: z.enum(LANGUAGE_PREFERENCES).default("auto"),
    /* A retired value (the former "auto") or any other invalid id reads as the
       default instead of failing the whole settings file. */
    titleAgent: backendSchema.catch(DEFAULT_TITLE_AGENT),
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
    defaultExecutionDeviceId: z.string().trim().min(1).max(256).nullable().default(null),
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
const settingsFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** 单调 revision：renderer 的 mutation queue 按它 rebase。 */
    revision: z.number().int().nonnegative(),
    settings: settingsSchema,
  })
  .strict();
type SettingsFile = z.infer<typeof settingsFileSchema>;

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
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { chatOptionsByScope: _retired, ...file } = value as Record<string, unknown>;
    return settingsFileSchema.parse(file);
  }
  return settingsFileSchema.parse(value);
}

export class SettingsStore {
  readonly filePath: string;
  private readonly queue = new SerialQueue();
  private state: SettingsFile = {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    settings: structuredClone(DEFAULT_SETTINGS) as SettingsFile["settings"],
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
        if (cause instanceof SyntaxError && await recoverDurableCorruption(this.filePath, await readFile(this.filePath, "utf8"))) { await this.persist(this.state); return; }
        await this.backupInvalid().catch(() => {});
        throw new Error("settings.json 损坏，已保留备份并停止加载", {
          cause,
        });
      }
      let next: SettingsFile;
      try {
        /* v11 是唯一可读版本，旧版本与未来版本同罪 fail-closed。 */
        next = parseFile(raw);
      } catch (cause) {
        if (await recoverDurableCorruption(this.filePath, await readFile(this.filePath, "utf8"))) { await this.persist(this.state); return; }
        await this.backupInvalid();
        throw new Error("settings.json schema 无效，已保留备份并停止加载", {
          cause,
        });
      }
      await this.persist(next);
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

  getBackendDefaults(backend: AgentBackendId = this.state.settings.lastSelectedBackend) {
    return backendDefaults(this.state.settings.defaultChatOptionsByBackend, backend);
  }

  rememberChatDefaults(value: AgentTurnOptions) {
    return this.queue.enqueue(async () => {
      const options = turnOptionsSchema.parse(value);
      if (options.permissionMode === "full-access" && this.state.settings.fullAccessAcknowledgedAt === null) {
        throw new Error("FULL_ACCESS_ACK_REQUIRED");
      }
      await this.commit({
        ...this.state,
        settings: {
          ...this.state.settings,
          lastSelectedBackend: options.backend,
          defaultChatOptionsByBackend: {
            ...this.state.settings.defaultChatOptionsByBackend,
            [options.backend]: optionsForNextConversation(options),
          },
        },
      });
      return this.envelope();
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
