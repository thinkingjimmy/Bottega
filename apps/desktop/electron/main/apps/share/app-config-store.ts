/**
 * [INPUT]: Depends on persistence/durable-json for fsync-backed writes, node:fs/promises for reads and removals, app-store-schema APP_ID_PATTERN, and the shared AppRequirement type; rooted at userData/app-config
 * [OUTPUT]: Provides AppConfigStore, EMPTY_APP_CONFIG, deriveAgentConfigEnvironment, safeConfigKey, validateConfigRequirements
 * [POS]: The confidentiality boundary of apps/share: config values live at 0600 and only agentReadableKeys reach an agent process, so workspace files, AGENTS.md and share packages never see them
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AppRequirement } from "../../../../shared/apps-ipc";
import { durableReplaceFile } from "../../persistence/durable-json";
import { APP_ID_PATTERN } from "../store/app-store-schema";
const configSchema = z
  .object({
    values: z.record(z.string().min(1).max(128), z.string().max(8 * 1024)),
    agentReadableKeys: z.array(z.string().min(1).max(128)).max(16),
  })
  .strict();

export type AppConfig = z.infer<typeof configSchema>;
export const EMPTY_APP_CONFIG: AppConfig = {
  values: {},
  agentReadableKeys: [],
};
const APP_CONFIG_MAX_KEYS = 16;
const APP_CONFIG_ENV_BYTE_LIMIT = 8 * 1024;

export class AppConfigStore {
  private readonly root: string;

  constructor(userData: string) {
    this.root = join(userData, "app-config");
  }

  async read(appId: string): Promise<AppConfig> {
    assertAppId(appId);
    try {
      return configSchema.parse(
        JSON.parse(await readFile(this.path(appId), "utf8"))
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_APP_CONFIG);
      }
      throw cause;
    }
  }

  /**
   * 保存即预演：requirements 在手时先跑一遍 env 派生，归一化冲突与
   * 16 项/8KB 预算在保存时爆，而不是留到 turn spawn 时砖住聊天。
   */
  async write(
    appId: string,
    value: AppConfig,
    requirements?: readonly AppRequirement[]
  ): Promise<AppConfig> {
    assertAppId(appId);
    const config = configSchema.parse(value);
    if (requirements) deriveAgentConfigEnvironment(config, requirements);
    return this.writeFile(this.path(appId), config);
  }

  stagePending(reference: string, value: AppConfig) {
    assertReference(reference);
    return this.writeFile(this.pendingPath(reference), configSchema.parse(value));
  }

  async readPending(reference: string) {
    assertReference(reference);
    return configSchema.parse(
      JSON.parse(await readFile(this.pendingPath(reference), "utf8"))
    );
  }

  async removePending(reference: string) {
    assertReference(reference);
    await rm(this.pendingPath(reference), { force: true });
  }

  environment(appId: string, requirements: readonly AppRequirement[]) {
    return this.read(appId).then((config) =>
      deriveAgentConfigEnvironment(config, requirements)
    );
  }

  private path(appId: string) {
    return join(this.root, `${appId}.json`);
  }

  private pendingPath(reference: string) {
    return join(this.root, `pending-${reference}.json`);
  }

  /** 入参已由调用方 parse 过一次;此处只校验交叉约束并落盘。 */
  private async writeFile(path: string, config: AppConfig) {
    const unknown = config.agentReadableKeys.find(
      (key) => !(key in config.values)
    );
    if (unknown) throw new Error(`Agent 可读配置 ${unknown} 没有对应值`);
    await durableReplaceFile(path, `${JSON.stringify(config, null, 2)}\n`);
    return structuredClone(config);
  }
}

export function deriveAgentConfigEnvironment(
  config: AppConfig,
  requirements: readonly AppRequirement[]
): NodeJS.ProcessEnv {
  const readable = new Set(config.agentReadableKeys);
  const environment: NodeJS.ProcessEnv = {};
  const mapped = new Set<string>();
  let bytes = 0;
  for (const requirement of requirements) {
    if (
      requirement.kind !== "config" ||
      !requirement.configKey ||
      !readable.has(requirement.configKey)
    ) {
      continue;
    }
    const value = config.values[requirement.configKey];
    if (value === undefined) continue;
    const safe = safeConfigKey(requirement.configKey);
    if (mapped.has(safe)) throw new Error(`配置环境变量归一化冲突：${safe}`);
    mapped.add(safe);
    const name = `APP_CONFIG_${safe}`;
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value);
    if (mapped.size > APP_CONFIG_MAX_KEYS || bytes > APP_CONFIG_ENV_BYTE_LIMIT) {
      throw new Error("Agent 配置注入超过 16 项或 8 KB");
    }
    environment[name] = value;
  }
  return environment;
}

/** 注入名恒为 APP_CONFIG_ 前缀,撞不到任何系统变量,故不需要保留字名单。 */
export function safeConfigKey(value: string) {
  const key = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
  if (!key) throw new Error("configKey 无法映射到安全环境变量");
  return key;
}

export function validateConfigRequirements(
  requirements: readonly AppRequirement[]
) {
  const mapped = new Set<string>();
  for (const requirement of requirements) {
    if (requirement.kind !== "config" || !requirement.configKey) continue;
    const safe = safeConfigKey(requirement.configKey);
    if (mapped.has(safe)) {
      throw new Error(`配置环境变量归一化冲突：${safe}`);
    }
    mapped.add(safe);
  }
}

function assertAppId(appId: string) {
  if (!APP_ID_PATTERN.test(appId)) throw new Error("App id 无效");
}

function assertReference(reference: string) {
  if (!/^[A-Za-z0-9-]{10,80}$/.test(reference)) {
    throw new Error("pending config reference 无效");
  }
}
