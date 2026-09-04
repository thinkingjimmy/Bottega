/**
 * [INPUT]: Depends on explicit AI_CHAT_STATE_RESET_V3–V5 flags, user data, ChatHome ownership ledger, and Node atomic filesystem operations
 * [OUTPUT]: Provides versioned reset passes through v5; v3 clears the App catalog and its authority seed together, while newer passes compensate independently
 * [POS]: Electron main cold-started versioned data cross-border; By default, the marker does not execute, the marker does not restart the task, and the old marker does not cover up the new clearance
 */

import {
  access,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { chatHomeLedgerSchema } from "./chat-home/ledger-values";

export const STATE_RESET_MARKER = "state-reset.v3";
export const STATE_RESET_V4_MARKER = "state-reset.v4";
export const STATE_RESET_V5_MARKER = "state-reset.v5";

/**
 * 通道 A 的业务状态全集。这里刻意枚举相对路径，不递归删除 userData 根：
 * Chromium 的登录态、窗口缓存与 Electron 自有文件不属于产品 schema。
 */
export const STATE_RESET_TARGETS = [
  "workflows",
  "workflow-retiring.json",
  "drain-receipt.json",
  "section-relay-ledger.json",
  "section-submission-payloads",
  "agent-custody",
  "chats",
  "projects.json",
  "project-rebinds.json",
  "apps.json",
  "apps-store.seed",
  "apps",
  "apps-state",
  "apps-settings.json",
  "app-config",
  "app-probes",
  "app-presets",
  "app-share",
  "app-data",
  "app-data-archives",
  "app-custody",
  "manifest-schema.json",
  "bases",
  "bases.json",
  "chat-attachments",
  "agent-input-staging",
  "chat-home-ledger.json",
  "chat-purge-journal.json",
  "deletion-journal",
  "archive.json",
  "lifecycle",
  "lifecycle.seed",
  "agent-extensions",
  /* 投影根里躺着扩展包字节的副本，overlay 里躺着「哪些 Claude 插件被产品
     停用」——两者都是产品自管状态，都不随 `agent-extensions` 一起消失。漏掉
     它们，清空之后既留着本该删的字节，又留着一条解释不了的停用记录。 */
  "agent-plugin-projections",
  "agent-plugin-overlays",
  "plugin-marketplaces",
  "memory",
  "memory-tools",
  "memory-runtimes",
  "mcp-servers.json",
  "gallery-media",
  "gallery-completions",
  "exports",
  "codex-workspace",
  "claude-agent",
  "claude-agent-homes",
  "codex-agent-homes",
  "codex-repair-homes",
  "kimi-agent-homes",
  "repair-workspaces",
  "repair-trash",
  "logs/apps",
  "bin",
  "settings.json",
  "settings.json.bak",
  "settings.json.invalid.bak",
  "usage-cache.json",
  "model-pricing-cache.json",
  "state-reset.v2",
] as const;

/** v3 已经提交过的真实用户只需补偿这一个遗漏根。 */
export const STATE_RESET_V4_TARGETS = ["app-data"] as const;

/** v5 owns Project-scoped tool policy, scoped MCP recovery copies, and sealed turn candidates. */
export const STATE_RESET_V5_TARGETS = [
  "project-tool-policies.json",
  "project-tool-policies.json.bak",
  "mcp-servers.json",
  "mcp-servers.json.bak",
  "mcp-servers.v1.bak",
  "agent-input-staging",
] as const;

export const STATE_RESET_V5_PREFIXES = [
  "project-tool-policies.json.",
  "mcp-servers.json.",
] as const;

/** 原子 Store 产生的同目录备份/隔离文件；旧 strict schema 不能留旁路副本。 */
export const STATE_RESET_PREFIXES = [
  "projects.json.",
  "apps.json.",
  "section-relay-ledger.json.",
  "settings.json.",
  "bases.json.",
] as const;

type ResetDependencies = {
  enabled?: boolean;
  exists?: (path: string) => Promise<boolean>;
  list?: (path: string) => Promise<string[]>;
  remove?: (path: string) => Promise<void>;
  write?: (path: string, value: string) => Promise<void>;
  move?: (source: string, destination: string) => Promise<void>;
  log?: (message: string) => void;
};

function target(userData: string, entry: string) {
  const root = resolve(userData);
  const resolved = resolve(root, entry);
  const child = relative(root, resolved);
  const separator = process.platform === "win32" ? "\\" : "/";
  if (!child || child.startsWith("..") || child.includes(`..${separator}`)) {
    throw new Error(`非法 reset target：${entry}`);
  }
  return resolved;
}

export async function runStateResetV3(
  userData: string,
  dependencies: ResetDependencies = {}
) {
  const enabled =
    dependencies.enabled ?? process.env.AI_CHAT_STATE_RESET_V3 === "1";
  if (!enabled) return false;
  return runResetPass(
    userData,
    {
      version: 3,
      markerName: STATE_RESET_MARKER,
      targets: STATE_RESET_TARGETS,
      prefixes: STATE_RESET_PREFIXES,
      removeHomes: true,
    },
    dependencies
  );
}

/**
 * v4 是补偿 pass，不是假装 v3 从未发布：已有 v3 marker 时只删 app-data；
 * 新环境只开 V4 时先强制完成完整 v3，再提交独立 v4 marker。
 */
export async function runStateResetV4(
  userData: string,
  dependencies: ResetDependencies = {}
) {
  const enabled =
    dependencies.enabled ?? process.env.AI_CHAT_STATE_RESET_V4 === "1";
  if (!enabled) return false;
  const exists = dependencies.exists ?? pathExists;
  if (await exists(join(userData, STATE_RESET_V4_MARKER))) return false;
  await runStateResetV3(userData, { ...dependencies, enabled: true });
  return runResetPass(
    userData,
    {
      version: 4,
      markerName: STATE_RESET_V4_MARKER,
      targets: STATE_RESET_V4_TARGETS,
      prefixes: [],
      removeHomes: false,
    },
    dependencies
  );
}

/**
 * v5 is the Project Tools compensation pass. A previously committed v3/v4
 * marker cannot hide stores introduced later, so v5 has its own marker and
 * repeats only the newly-owned exact roots and recovery siblings.
 */
export async function runStateResetV5(
  userData: string,
  dependencies: ResetDependencies = {}
) {
  const enabled =
    dependencies.enabled ?? process.env.AI_CHAT_STATE_RESET_V5 === "1";
  if (!enabled) return false;
  const exists = dependencies.exists ?? pathExists;
  if (await exists(join(userData, STATE_RESET_V5_MARKER))) return false;
  await runStateResetV4(userData, { ...dependencies, enabled: true });
  return runResetPass(
    userData,
    {
      version: 5,
      markerName: STATE_RESET_V5_MARKER,
      targets: STATE_RESET_V5_TARGETS,
      prefixes: STATE_RESET_V5_PREFIXES,
      removeHomes: false,
    },
    dependencies
  );
}

export async function runStateResetsThroughV5(userData: string) {
  await runStateResetV3(userData);
  await runStateResetV4(userData);
  await runStateResetV5(userData);
}

async function runResetPass(
  userData: string,
  spec: {
    version: number;
    markerName: string;
    targets: readonly string[];
    prefixes: readonly string[];
    removeHomes: boolean;
  },
  dependencies: ResetDependencies
) {
  const marker = join(userData, spec.markerName);
  const exists = dependencies.exists ?? pathExists;
  if (await exists(marker)) return false;

  const remove =
    dependencies.remove ??
    ((path: string) => rm(path, { recursive: true, force: true }));
  const log = dependencies.log ?? console.info;
  const deletedPaths: string[] = [];
  const removeTracked = async (path: string) => {
    if (!(await exists(path))) return;
    await remove(path);
    deletedPaths.push(path);
    log(`[${spec.markerName}] removed ${path}`);
  };

  if (spec.removeHomes) await removeVerifiedHomes(userData, removeTracked);
  for (const entry of spec.targets) {
    await removeTracked(target(userData, entry));
  }
  const list = dependencies.list ?? ((path: string) => readdir(path));
  const siblings = await list(userData).catch(() => []);
  for (const entry of siblings.sort()) {
    if (spec.prefixes.some((prefix) => entry.startsWith(prefix))) {
      await removeTracked(target(userData, entry));
    }
  }

  const temporary = `${marker}.tmp`;
  await remove(temporary);
  const value = `${JSON.stringify(
    {
      version: spec.version,
      completedAt: new Date().toISOString(),
      deletedPaths,
    },
    null,
    2
  )}\n`;
  await (
    dependencies.write ??
    ((path, source) => writeFile(path, source, { mode: 0o600 }))
  )(temporary, value);
  await (dependencies.move ?? rename)(temporary, marker);
  log(`[${spec.markerName}] completed ${marker}`);
  return true;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function removeVerifiedHomes(
  userData: string,
  remove: (path: string) => Promise<void>
) {
  let ledger;
  try {
    ledger = chatHomeLedgerSchema.parse(
      JSON.parse(await readFile(join(userData, "chat-home-ledger.json"), "utf8"))
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    return;
  }
  for (const record of Object.values(ledger.chats)) {
    if (record.ownership !== "valid") continue;
    try {
      const rootStat = await stat(record.canonicalRoot);
      if (
        String(rootStat.dev) !== record.rootIdentity.dev ||
        String(rootStat.ino) !== record.rootIdentity.ino ||
        (await realpath(record.homeDir)) !==
          join(record.canonicalRoot, record.chatId) ||
        (await lstat(record.homeDir)).isSymbolicLink()
      ) {
        continue;
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      continue;
    }
    await remove(record.homeDir);
  }
}
