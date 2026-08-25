/**
 * [INPUT]: Depends on Node fs/os/path, runtime-probe Minimum user environment with KIMI_CODE_HOME/KIMI_CODE_CACHE_DIR option
 * [OUTPUT]: Provides a Kimi state root/environment/launcher/sessionId validator, and file-sharing authentication, session isolation/cache and declaration of the source read-only disposable home (readiness shared with ephemeral headless)
 * [POS]: The user status directory of backends/kimi is a single source of truth; Interactive with persistent roots, readiness/ephemeral headless with one-time writing roots
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sanitizedProcessEnvironment } from "../runtime-probe";
import type { AcpLauncher, AgentRuntime } from "../types";
import { BUILTIN_CLIENT_TIMEOUT_MS } from "../../../../shared/builtin-tools";

const SESSION_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export const validateKimiSessionId = (id: string) => SESSION_PATTERN.test(id);

export function resolveKimiCodeHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir()
) {
  const configured = env.KIMI_CODE_HOME?.trim();
  return resolve(configured || join(userHome, ".kimi-code"));
}

export function kimiEnvironment(runtime: AgentRuntime) {
  return {
    ...sanitizedProcessEnvironment(runtime.path),
    KIMI_CODE_HOME: resolveKimiCodeHome(),
    KIMI_MCP_TOOL_TIMEOUT_MS: String(BUILTIN_CLIENT_TIMEOUT_MS),
  } satisfies NodeJS.ProcessEnv;
}

const SHARED_STATE_ENTRIES = [
  "config.toml",
  "tui.toml",
  "credentials",
  "oauth",
  "device_id",
  "migrations-effort.json",
] as const;

export type DisposableKimiHome = {
  path: string;
  cachePath: string;
  readOnlyRoots: string[];
  release(): Promise<void>;
};

async function linkEntry(source: string, target: string): Promise<void> {
  const stat = await lstat(source);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    await mkdir(target, { mode: 0o700 });
    for (const name of await readdir(source)) {
      await linkEntry(join(source, name), join(target, name));
    }
    return;
  }
  await symlink(source, target);
}

async function linkIfPresent(sourceRoot: string, targetRoot: string, name: string) {
  const source = join(sourceRoot, name);
  try {
    await lstat(source);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  await linkEntry(source, join(targetRoot, name));
}

/**
 * Kimi CLI 把 sessions 写死在 `join(home, "sessions")`，且没有 no-persist/
 * ignore-config flag。0.34.0 ACP 已广播 session/delete 并真删 session 目录
 * （2026-08-23 真机 dev/kimi-session-delete-probe.mjs，结论行在
 * dev/agent-cli-docs.md；acp/probe.ts 的清理已按能力位消费它），但补偿
 * 替代不了换根：headless `-p` 路径没有 ACP 通道；probe 清理在超时/
 * transport 死亡/取消时如实跳过；且 session/new 零 prompt 即落盘，delete
 * 后 session_index.jsonl 仍留 created+tombstone 两条记录（含 cwd 全路径），
 * workspaces.json 与空 wd_* 桶永久残留。readiness 探测与 ephemeral headless
 * 因此共用同一答案：复用认证与配置（逐文件 symlink，不复制凭据），
 * sessions、session_index、日志和缓存全部落在一次性根，进程清理后整根
 * 删除——残留结构性归零，不靠补偿分支。
 */
export async function createDisposableKimiHome(
  sourceRoot = resolveKimiCodeHome()
): Promise<DisposableKimiHome> {
  const canonicalSourceRoot = resolve(sourceRoot);
  const root = await mkdtemp(join(tmpdir(), "ai-chat-kimi-home-"));
  const path = join(root, "state");
  const cachePath = join(root, "native-cache");
  let released = false;
  try {
    await Promise.all([
      mkdir(path, { mode: 0o700 }),
      mkdir(cachePath, { mode: 0o700 }),
    ]);
    for (const name of SHARED_STATE_ENTRIES) {
      await linkIfPresent(canonicalSourceRoot, path, name);
    }
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
  return {
    path,
    cachePath,
    /* 链接只解决“不复制凭据”；真正的不可回写由消费方 Seatbelt——readiness
       围栏与 headless executor 围栏——把这个源根加入 read allow、留在默认
       write deny 中。 */
    readOnlyRoots: [canonicalSourceRoot],
    async release() {
      if (released) return;
      released = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * ACP 进程启动三元组。放在 home.ts 而不是 descriptor 里，是为了让
 * `createTurn` 与 readiness 探测都能取到同一份而**不产生 index↔auth 循环**：
 * 环境与启动方式本就是同一件事，它们的真相源在这里。
 */
export const kimiAcpLaunch: AcpLauncher = (runtime, overlay) => ({
  command: runtime.executable,
  args: ["acp"],
  env: { ...kimiEnvironment(runtime), ...overlay?.processEnv },
});
