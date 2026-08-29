/**
 * [INPUT]: Depends on runtime-probe Minimum user environment, credential root, authorized processEnv, disposable Kimi home and General HeadlessJob/ExecutionSpec
 * [OUTPUT]: Provides KimiHeadlessSpec, translates the job containing title/processEnv into the Kimi stream-json command and parses the assistant/tool/meta line; The first time I saw a KIMI_CODE_HOME session, I was in the middle of a week
 * [POS]: The Kimi descriptor is a translation layer without a guard; CLI does not support prompt+auto, prompt is as a validated argv exception and stdin is shut down immediately
 */

import type {
  HeadlessExecutionSpec,
  HeadlessJob,
  HeadlessParserState,
  ResolvedRuntime,
} from "../types";
import {
  createDisposableKimiHome,
  kimiEnvironment,
  resolveKimiCodeHome,
} from "./home";

function promptFor(job: HeadlessJob) {
  return [
    job.prompt,
    job.untrustedContent
      ? `\n<untrusted>\n${job.untrustedContent}\n</untrusted>`
      : "",
  ].join("");
}

function parseEventLine(
  line: string,
  state: HeadlessParserState,
  wantsJson: boolean
) {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;
  const record = event as {
    role?: unknown;
    content?: unknown;
  };
  if (record.role !== "assistant" || typeof record.content !== "string") return;
  state.text = record.content;
  if (!wantsJson) return;
  try {
    state.json = JSON.parse(record.content);
  } catch {
    state.json = undefined;
  }
}

/* ============================================================
 * 边界（2026-08-11 真机复核 0.34.0：`--help` 无相关 flag；strings 证实
 * sessions 写死 `join(home, "sessions")`，环境变量清单亦无会话开关）：
 * Kimi CLI 没有 no-persist / ignore-user-config / output-schema 开关。
 *
 * `job.ephemeral` 因此不靠 CLI 兑现，而靠换根（即此前账本里的根治方案，
 * 2026-08-11 落地）：一次性 KIMI_CODE_HOME 逐文件 symlink 凭据、隔离
 * sessions/cache，真实源根只进围栏只读面，run 结束由 executor release
 * 整根删除。
 *
 * 仍未兑现的两半，如实声明勿静默：
 *   - ignoreUserConfig: config.toml/tui.toml 仍经 symlink 共享（CLI 缺
 *     provider/endpoint 配置无法运行），只兑现「不落回写、code-home
 *     skills 不可见」，用户 config/hooks 照常生效；
 *   - outputSchema: 只能靠 prompt 约定 + 尽力 JSON.parse。
 * 见 DEV/agents/deferred/multi-backend.md 与 DEV/agents/docs/agent-cli-docs.md。
 * ============================================================ */
export async function kimiHeadlessSpec(
  job: HeadlessJob,
  runtime: ResolvedRuntime
): Promise<HeadlessExecutionSpec> {
  if (job.env !== "user-default" || job.homeDir) {
    throw new Error("Kimi headless job 必须使用 user-default 环境");
  }
  const home = job.ephemeral ? await createDisposableKimiHome() : undefined;
  const env = {
    ...kimiEnvironment(runtime),
    ...job.processEnv,
    /* 一次性根压轴：ephemeral 是诚实性承诺，任何授权 env 都不得把它改回
       持久根。cache 同步隔离，SEA native cache 不落用户目录。 */
    ...(home
      ? {
          KIMI_CODE_HOME: home.path,
          KIMI_CODE_CACHE_DIR: home.cachePath,
          /* 上游官方 opt-out（`resolveLockTarget` 首行即
             `if (process.env["KIMI_DISABLE_OAUTH_LOCK"] === "1") return void 0`）。
             跑 prompt 前 kimi 会在 `<configDir>/oauth/<provider>` 抢一把跨进程
             刷新锁；而 `oauth` 正是 SHARED_STATE_ENTRIES 里按 symlink 共享、
             源根声明为**只读**的一项 ⇒ 围栏内必得 EPERM 且致命。
             关掉锁 = 凭据目录维持只读，与 ephemeral 的「不落回写」同向；
             代价是失去跨进程刷新互斥，而 ephemeral headless 本就是一次性
             单进程、不共享刷新窗口，这个代价不存在。
             **非版本行为**：0.34–0.39 该开关逐字节同源，不是为 0.39 打的补丁。
             只在 ephemeral 注入：交互 turn 走用户真实 HOME，锁合法且无害。
             取证见真值账 §一 kimi oauth 锁行。 */
          KIMI_DISABLE_OAUTH_LOCK: "1",
        }
      : {}),
  };
  return {
    command: runtime.executable,
    args: [
      "-p",
      promptFor(job),
      "--output-format",
      "stream-json",
      ...(job.model ? ["--model", job.model] : []),
    ],
    env,
    credentialRoots: [resolveKimiCodeHome(env)],
    ...(home
      ? { readOnlyRoots: home.readOnlyRoots, release: () => home.release() }
      : {}),
    stdin: "",
    parseLine: (line, state) =>
      parseEventLine(line, state, Boolean(job.outputSchema)),
  };
}
