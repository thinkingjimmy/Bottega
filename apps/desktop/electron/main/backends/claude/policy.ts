/**
 * [INPUT]: Depends on @anthropic-ai/claude-agent-sdk resolveSettings (lazy dynamic import, managed-policy tier only) and node:path isAbsolute
 * [OUTPUT]: Provides readClaudeExecutablePolicy, classifyClaudePolicyValue, describeClaudePolicyRejection and the ClaudeExecutablePolicy union
 * [POS]: backends/claude managed-policy pre-reader consumed by index.ts detectRuntime/confirmRuntime; best-effort by design because the adapter re-reads the same policy inside its own process
 */

import { isAbsolute } from "node:path";

export type ClaudeExecutablePolicy =
  | { kind: "unset" }
  /* 空串、非字符串、非绝对路径都归这里：adapter 会把它原样写进 process.env，
     SDK 再把空值当"未设置"去找自带二进制——这是配置错误，不是产品路径。 */
  | { kind: "invalid"; value: string }
  | { kind: "path"; executable: string };

export type ClaudePolicyEnvironment =
  | Readonly<Record<string, string>>
  | undefined;

export type ClaudePolicyReader = (
  signal?: AbortSignal
) => Promise<ClaudePolicyEnvironment>;

const POLICY_KEY = "CLAUDE_CODE_EXECUTABLE";
const POLICY_REJECTION =
  "Claude managed policy 将 CLAUDE_CODE_EXECUTABLE 设为空值或非绝对路径，已拒绝启动";

let sdkReader: Promise<ClaudePolicyReader> | undefined;

/* SDK 1.3 MB，只在 Claude 后端首次探测时加载一次；`settingSources: []` 仍读
   managed policy 层（macOS plist/managed-settings.json、Windows 注册表、
   Linux /etc/claude-code），不触网、不需要 cwd。加载失败即抛且不缓存失败，
   下一次探测重试——fail-closed 但可恢复。 */
function loadSdkReader() {
  sdkReader ??= import("@anthropic-ai/claude-agent-sdk")
    .then((sdk): ClaudePolicyReader => async () => {
      const settings = await sdk.resolveSettings({ settingSources: [] });
      return settings.effective.env;
    })
    .catch((cause) => {
      sdkReader = undefined;
      throw cause;
    });
  return sdkReader;
}

export function classifyClaudePolicyValue(
  value: unknown
): ClaudeExecutablePolicy {
  if (value === undefined) return { kind: "unset" };
  if (typeof value === "string" && value.trim() !== "" && isAbsolute(value)) {
    return { kind: "path", executable: value };
  }
  return { kind: "invalid", value: String(value) };
}

export async function readClaudeExecutablePolicy(
  reader?: ClaudePolicyReader,
  signal?: AbortSignal
): Promise<ClaudeExecutablePolicy> {
  signal?.throwIfAborted();
  const read = reader ?? (await loadSdkReader());
  const environment = await read(signal);
  signal?.throwIfAborted();
  return classifyClaudePolicyValue(environment?.[POLICY_KEY]);
}

export function describeClaudePolicyRejection() {
  return POLICY_REJECTION;
}
