/**
 * [INPUT]: Node fs/path, zod, shared preference policy, Agent/Settings IPC, the live Provider catalog, durable persistence and SerialQueue.
 * [OUTPUT]: SettingsStore v11 with atomic recent-Chat preferences, complete per-Agent model options, conditional/no-op learning, configured-default fallback and stored Provider preservation.
 * [POS]: apps/desktop/electron/main/settings; The canonical multi-backend settings owner in Electron main
 * Persists local workflow Memory opt-in with a default of false.
 */

import { recoverDurableCorruption } from "../persistence/recovery-policy";
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
import { providerIdSchema } from "@ai-chat/cloud-protocol/contracts/provider-id-schema";
import type {
  AgentBackendId,
  AgentTurnOptions,
} from "../../../shared/ipc/agent/agent-ipc";
import { AGENT_BACKEND_ORDER } from "../../../shared/ipc/agent/agent-ipc";
import {
  MEMORY_SHARING_MODES,
  type AppSettings,
  type MemorySettings,
  type RendererSettingsPatch,
  type SettingsEnvelope,
} from "../../../shared/ipc/settings/settings-ipc";
import { THEME_PREFERENCES } from "../../../shared/ipc/settings/settings-ipc";
import { LANGUAGE_PREFERENCES } from "@ai-chat/ui/lib/locale";
import {
  DEFAULT_MEMORY_PROVIDER_ID,
  MEMORY_PROVIDER_IDS,
} from "../memory/providers/registry";
import { SerialQueue } from "../persistence/serial-queue";
import { backendDefaults, defaultsSchema, chatTurnOptionsSchema, type ChatAgentId, type ChatTurnOptions } from "../../../shared/chat-agent/options";
import { chatPreferenceWriteSchema, isFactoryChatOptions, learnChatPreferences, newChatBackend } from "../../../shared/chat-agent/preferences";
import { DEFAULT_PROVIDER_ID } from "../../../shared/providers/catalog";
import { builtinProviderCatalog, type ProviderCatalog } from "../../../shared/providers/catalog";
import { mergeProviderMaps, patchProviderChoices, PROVIDER_ORDER_LIMIT, projectProviderFields, readProviderFields, type ProjectedProviderFields, type ProviderChoicesPatch, type StoredProviderFields } from "./provider-fields";
export { DEFAULT_CHAT_OPTIONS_BY_BACKEND } from "../../../shared/chat-agent/options";
const optionValue = z.string().trim().min(1).max(200);
const DEFAULT_TITLE_AGENT: AgentBackendId = DEFAULT_PROVIDER_ID;

const SCHEMA_VERSION = 11;
const DEFAULT_SETTINGS: AppSettings = {
  libraryRoot: null,
  libraryId: null,
  chatHomesRoot: null,
  chatHomeState: "unconfigured",
  allowCrossChatRead: false,
  memoryPhoneFacade: false,
  memoryWorkflowRoles: false,
  disabledBuiltinTools: [],
  fullAccessAcknowledgedAt: null,
  launchAtLogin: false,
  keepRunningInBackground: false,
  showTaskStatusAtTop: false,
  theme: "auto",
  archiveConfettiEnabled: true,
  language: "auto",
  titleAgent: DEFAULT_TITLE_AGENT,
  titleModelByBackend: { codex: null },
  defaultChatOptionsByBackend: {},
  defaultBackend: DEFAULT_PROVIDER_ID,
  lastChatBackend: null,
  chatPreferenceVersion: 1,
  providerOrder: [...AGENT_BACKEND_ORDER],
  agentSetupDeferred: false,
  computerNameHintSeen: false,
  autoRelayLimit: 25,
  usagePricingAutoRefresh: true,
  skillsOnboarding: "pending",
  keyboardShortcuts: {},
  memory: {
    pluginEnabled: false,
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
    pluginEnabled: z.boolean().default(false),
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
    memoryPhoneFacade: z.boolean().default(false),
    memoryWorkflowRoles: z.boolean().default(false),
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
    /* 与 theme 同为 additive default：旧档缺键时仍可直接读。 */
    language: z.enum(LANGUAGE_PREFERENCES).default("auto"),
    /* A retired value (the former "auto") or any other invalid id reads as the
       default instead of failing the whole settings file. */
    titleAgent: providerIdSchema.catch(DEFAULT_TITLE_AGENT),
    titleModelByBackend: z.record(providerIdSchema, optionValue.nullable().optional()),
    defaultChatOptionsByBackend: defaultsSchema,
    /* Additive defaults keep existing strict settings files readable. */
    /* Projected by settings/provider-fields: a listed package Provider reads back as itself (TASK-11 S3-d). */
    defaultBackend: providerIdSchema.catch(DEFAULT_PROVIDER_ID),
    lastChatBackend: providerIdSchema.nullable().optional().default(null),
    chatPreferenceVersion: z.literal(1).default(1),
    /* The full stored order (S3-c); it is always projected by settings/provider-fields before it reaches this schema. */
    providerOrder: z.array(providerIdSchema).max(PROVIDER_ORDER_LIMIT),
    /* Additive default keeps existing strict settings files readable. */
    agentSetupDeferred: z.boolean().default(false),
    /* Additive default keeps existing strict settings files readable. */
    computerNameHintSeen: z.boolean().default(false),
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
/* TASK-11 S3-a: the Provider fields are read tolerantly into their stored form (a fifth or gone Provider kept verbatim) and projected
   onto the closed AppSettings; everything else in the file keeps today's strict schema. */
const PROVIDER_KEYS = ["titleAgent", "titleModelByBackend", "defaultChatOptionsByBackend", "defaultBackend", "providerOrder"] as const;
const restFileSchema = settingsFileSchema.extend({
  settings: settingsSchema.omit(Object.fromEntries(PROVIDER_KEYS.map((key) => [key, true])) as { [K in (typeof PROVIDER_KEYS)[number]]: true }),
});
const warnSettings = (message: string) => console.warn(message);
const providerView = (settings: AppSettings): ProjectedProviderFields => ({ titleAgent: settings.titleAgent,
  titleModelByBackend: settings.titleModelByBackend, defaultChatOptionsByBackend: settings.defaultChatOptionsByBackend,
  defaultBackend: settings.defaultBackend, providerOrder: settings.providerOrder });

function parseFile(value: unknown, catalog: ProviderCatalog): { file: SettingsFile; stored: StoredProviderFields } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("settings.json must be an object");
  const { chatOptionsByScope: _retired, ...file } = value as Record<string, unknown>;
  if (!file.settings || typeof file.settings !== "object" || Array.isArray(file.settings)) throw new Error("settings.json has no settings object");
  /* Retired fields are discarded; current last-use preferences have their own marker and narrow write command. */
  const { lastSelectedBackend: _lastUsed, agentConnectionsEnabled: _lab, ...settings } = file.settings as Record<string, unknown>;
  const providerFields = Object.fromEntries(PROVIDER_KEYS.map((key) => [key, settings[key]]));
  for (const key of PROVIDER_KEYS) delete settings[key];
  const stored = readProviderFields(providerFields, warnSettings);
  if (settings.chatPreferenceVersion === undefined && settings.lastChatBackend == null) {
    const view = projectProviderFields(stored, catalog, warnSettings);
    for (const backend of AGENT_BACKEND_ORDER) {
      const options = view.defaultChatOptionsByBackend[backend];
      if (options && isFactoryChatOptions(options)) delete stored.defaultChatOptionsByBackend[backend];
    }
  }
  const rest = restFileSchema.parse({ ...file, settings });
  return { file: { ...rest, settings: { ...rest.settings, ...projectProviderFields(stored, catalog, warnSettings) } }, stored };
}

export class SettingsStore {
  readonly filePath: string;
  private readonly queue = new SerialQueue();
  private state: SettingsFile = {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    settings: structuredClone(DEFAULT_SETTINGS) as SettingsFile["settings"],
  };
  /** The settings file's Provider fields as stored: a Provider this build does not know stays here and is written back verbatim. */
  private stored: StoredProviderFields = readProviderFields(providerView(DEFAULT_SETTINGS), warnSettings);
  private readonly watchers = new Set<(envelope: SettingsEnvelope) => void>();

  private unwatchCatalog: (() => void) | null = null;

  /** The catalog every stored Provider choice is read through (TASK-11 S3); the built-ins until the live one is handed over. */
  constructor(userData: string, private catalog: ProviderCatalog = builtinProviderCatalog) {
    this.filePath = join(userData, "settings.json");
  }

  /**
   * The live Provider catalog, once the foundation has composed it (TASK-11 S3-d): each change re-reads the stored choices through it, so
   * a package default reads back as itself while it is available and as the effective built-in otherwise, and the windows hear of it.
   */
  useProviderCatalog(port: Readonly<{ catalog(): ProviderCatalog; subscribe(listener: () => void): () => void }>) {
    this.unwatchCatalog?.();
    const apply = () => { this.catalog = port.catalog(); void this.queue.enqueue(() => this.reproject()); };
    this.unwatchCatalog = port.subscribe(apply);
    apply();
  }

  /** Resolves once every queued write and re-read has settled. */
  settled() {
    return this.queue.enqueue(async () => {});
  }

  private async reproject() {
    const choices = projectProviderFields(this.stored, this.catalog, warnSettings), current = this.state.settings;
    if (choices.defaultBackend === current.defaultBackend && choices.titleAgent === current.titleAgent &&
      JSON.stringify(choices.providerOrder) === JSON.stringify(current.providerOrder)) return;
    await this.commit({ ...this.state, settings: settingsSchema.parse({ ...current, defaultBackend: choices.defaultBackend,
      titleAgent: choices.titleAgent, providerOrder: choices.providerOrder }) });
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
      let next: ReturnType<typeof parseFile>;
      try {
        /* v11 是唯一可读版本，旧版本与未来版本同罪 fail-closed。 */
        next = parseFile(raw, this.catalog);
      } catch (cause) {
        if (await recoverDurableCorruption(this.filePath, await readFile(this.filePath, "utf8"))) { await this.persist(this.state); return; }
        await this.backupInvalid();
        throw new Error("settings.json schema 无效，已保留备份并停止加载", {
          cause,
        });
      }
      this.stored = next.stored;
      await this.persist(next.file);
      this.state = next.file;
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
  set(patch: Omit<RendererSettingsPatch, "memory">) {
    return this.setTrusted(patch);
  }

  /** The three Provider choices go straight onto the stored form (any well-formed id); everything else is parsed as today. */
  setTrusted(patch: Omit<Partial<AppSettings>, "titleAgent" | "defaultBackend"> & ProviderChoicesPatch) {
    return this.queue.enqueue(async () => {
      const { titleAgent, defaultBackend, providerOrder, ...rest } = patch;
      const stored = patchProviderChoices(this.stored, {
        ...(titleAgent !== undefined ? { titleAgent } : {}),
        ...(defaultBackend !== undefined ? { defaultBackend } : {}),
        ...(providerOrder !== undefined ? { providerOrder } : {}),
      }, this.catalog);
      const choices = projectProviderFields(stored, this.catalog, warnSettings);
      const settings = settingsSchema.parse({
        ...this.state.settings,
        ...rest,
        ...(defaultBackend !== undefined ? { lastChatBackend: null } : {}),
        titleAgent: choices.titleAgent,
        defaultBackend: choices.defaultBackend,
        providerOrder: choices.providerOrder,
      });
      await this.commit({ ...this.state, settings }, stored);
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

  getBackendDefaults(): ChatTurnOptions;
  getBackendDefaults(backend: AgentBackendId): AgentTurnOptions;
  getBackendDefaults(backend: ChatAgentId): ChatTurnOptions;
  /** New Chat restores the last-used Agent and its options; explicit reads remain per-Agent. */
  getBackendDefaults(backend?: ChatAgentId): ChatTurnOptions {
    const selected = backend ?? newChatBackend(this.state.settings, id => this.catalog.get(id).known);
    return backendDefaults(this.state.settings.defaultChatOptionsByBackend, selected);
  }

  /** Parses its input: the registrar hands the renderer's value over uncast. */
  rememberChatDefaults(value: unknown, preference?: unknown) {
    return this.queue.enqueue(async () => {
      const options = chatTurnOptionsSchema.parse(value);
      const write = chatPreferenceWriteSchema.parse(preference);
      if (!this.catalog.get(options.backend).known) throw new Error("PROVIDER_UNAVAILABLE");
      if (options.permissionMode === "full-access" && this.state.settings.fullAccessAcknowledgedAt === null) {
        throw new Error("FULL_ACCESS_ACK_REQUIRED");
      }
      const learned = learnChatPreferences(this.state.settings, options, write);
      if (!learned) return this.envelope();
      await this.commit({
        ...this.state,
        settings: {
          ...this.state.settings,
          ...learned,
        },
      });
      return this.envelope();
    });
  }

  async closeAndFlush() {
    this.unwatchCatalog?.(); this.unwatchCatalog = null;
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
  private async commit(next: SettingsFile, choices: StoredProviderFields = this.stored) {
    const committed: SettingsFile = { ...next, revision: this.state.revision + 1 };
    const stored = mergeProviderMaps(choices, providerView(this.state.settings), providerView(committed.settings));
    await this.persist(committed, stored);
    this.stored = stored;
    this.state = committed;
    const envelope = this.envelope();
    for (const watcher of this.watchers) watcher(envelope);
  }

  /** Writes the stored form of the Provider fields, never their projection: an unknown Provider's values survive every write. */
  private async persist(state: SettingsFile, stored: StoredProviderFields = this.stored) {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    /* An absent or malformed stored choice is written as the one in effect, never as null. */
    const merged: Record<string, unknown> = { ...state.settings, ...stored, titleAgent: stored.titleAgent ?? state.settings.titleAgent,
      defaultBackend: stored.defaultBackend ?? state.settings.defaultBackend };
    /* In the canonical key order, so an unchanged file writes back byte for byte whatever order the fields were read in. */
    const order = [...Object.keys(DEFAULT_SETTINGS), ...Object.keys(merged).filter((key) => !(key in DEFAULT_SETTINGS))];
    const file = { ...state, settings: Object.fromEntries(order.filter((key) => key in merged).map((key) => [key, merged[key]])) };
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
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
