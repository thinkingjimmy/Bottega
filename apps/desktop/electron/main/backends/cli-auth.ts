/**
 * [INPUT]: Depends on Node execFile, ACP Share Diagnosis of hypersensitivity with feedback/environment injected at each end
 * [OUTPUT]: Provides createCLIAuthCheck to project the unauthenticated Unified CLI authentication probe core to verify the unlogged ((code=1 and non-kill/timeout)
 * [POS]: The CLI auth assessment mechanism layer of backends; Claude/Codex only declares subcommand, environment and newsletter judgments, and RIGOR is no longer home-based
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  redactAcpDiagnostic,
  type AcpDiagnosticRedactionOptions,
} from "./acp/trace";
import type { AuthCheckResult, ResolvedRuntime } from "./types";

const execFileAsync = promisify(execFile);
const AUTH_TIMEOUT_MS = 8_000;
const DIAGNOSTIC_LIMIT = 2_048;

const text = (value: unknown) =>
  typeof value === "string" || Buffer.isBuffer(value)
    ? String(value).trim()
    : "";

export type CliAuthProbeSpec = {
  /** 诊断文案主语，如 "Codex" */
  displayName: string;
  /** 认证状态子命令，如 ["login", "status"] */
  args: string[];
  environment(runtime: ResolvedRuntime): NodeJS.ProcessEnv;
  /** 确证「未登录」的报文判据；成功与失败两条路共用同一份 */
  reportsLoggedOut(output: string): boolean;
  /** 未登录 reason；output 已脱敏截断。只陈述 CLI 说了什么，不含产品指令 */
  loggedOutReason(output: string): string;
  /** stderr 优先还是只看 stdout；缺省只看 stdout */
  outputStreams?: "stdout" | "stderr-first";
  redaction(env: NodeJS.ProcessEnv): AcpDiagnosticRedactionOptions;
};

/* ============================================================
 * 「未登录」是用户状态，必须**确证**而非猜测：只有 CLI 正常跑完并以
 * code=1 主动说出未登录报文才算数（真机取证：claude/codex 未登录均
 * exit 1）。timeout（code=null + killed）、被信号打死、ENOENT（code
 * 为字符串）留下的半截 stdout 一律不得伪装成用户状态——那是探针故障，
 * 归 error 并保留脱敏诊断。
 * ============================================================ */
function confirmsLoggedOut(
  cause: unknown,
  output: string,
  reportsLoggedOut: (value: string) => boolean
) {
  const error = cause as {
    code?: unknown;
    signal?: unknown;
    killed?: unknown;
  };
  return (
    error.code === 1 &&
    error.signal == null &&
    error.killed !== true &&
    reportsLoggedOut(output)
  );
}

export function createCliAuthCheck(spec: CliAuthProbeSpec) {
  const safeText = (value: string, env: NodeJS.ProcessEnv) =>
    redactAcpDiagnostic(value, spec.redaction(env)).slice(-DIAGNOSTIC_LIMIT);

  const pickOutput = (stdout: unknown, stderr: unknown) =>
    spec.outputStreams === "stderr-first"
      ? text(stderr) || text(stdout)
      : text(stdout);

  const exitDiagnostic = (cause: unknown, env: NodeJS.ProcessEnv) => {
    const error = cause as {
      code?: unknown;
      signal?: unknown;
      killed?: unknown;
      stderr?: unknown;
      stdout?: unknown;
      message?: unknown;
    };
    const code =
      typeof error?.code === "number"
        ? error.code
        : String(error?.code ?? "null");
    const signal = typeof error?.signal === "string" ? error.signal : "null";
    const killed = error?.killed === true ? ", killed=true" : "";
    const detail =
      text(error?.stderr) || text(error?.stdout) || text(error?.message);
    const head = `${spec.displayName} 认证探测失败（code=${code}, signal=${signal}${killed}）`;
    return detail ? `${head}：${safeText(detail, env)}` : head;
  };

  const classifyFailure = (
    cause: unknown,
    env: NodeJS.ProcessEnv = process.env
  ): AuthCheckResult => {
    const output = pickOutput(
      (cause as { stdout?: unknown })?.stdout,
      (cause as { stderr?: unknown })?.stderr
    );
    return output && confirmsLoggedOut(cause, output, spec.reportsLoggedOut)
      ? {
          status: "unauthenticated",
          reason: spec.loggedOutReason(safeText(output, env)),
        }
      : { status: "error", reason: exitDiagnostic(cause, env) };
  };

  const check = async (
    runtime: ResolvedRuntime,
    signal?: AbortSignal
  ): Promise<AuthCheckResult> => {
    const env = spec.environment(runtime);
    try {
      const { stdout, stderr } = await execFileAsync(
        runtime.executable,
        spec.args,
        { encoding: "utf8", env, timeout: AUTH_TIMEOUT_MS, signal }
      );
      const output = pickOutput(stdout, stderr);
      return output && spec.reportsLoggedOut(output)
        ? {
            status: "unauthenticated",
            reason: spec.loggedOutReason(safeText(output, env)),
          }
        : { status: "authenticated" };
    } catch (cause) {
      signal?.throwIfAborted();
      return classifyFailure(cause, env);
    }
  };

  return { check, classifyFailure };
}
