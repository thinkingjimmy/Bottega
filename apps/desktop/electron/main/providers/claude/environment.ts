/**
 * [INPUT]: Depends on reliable runtime PATH/executable file and process cloud routing environment
 * [OUTPUT]: Provides Claude ACP subsystems with minimal environment, production launcher and cloud routing whitelist (the sessionId validator is in turn-config.ts)
 * Workflow launches force CLAUDE_CODE_DISABLE_AUTO_MEMORY after caller environment overrides.
 * [POS]: Environment seam for the Claude backend; never reads, copies, or rewrites credentials or ~/.claude configuration
 */

import { sanitizedProcessEnvironment } from "../../backends/runtime/runtime-probe";
import type { AcpLauncher, ResolvedRuntime } from "../../backends/types";
import { adapterLaunch } from "../../runtime";

const CLAUDE_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_AWS_WORKSPACE_ID",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "CLOUD_ML_REGION",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_SUBSCRIPTION_ID",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
] as const;

/** The managed-settings file every Claude turn loads on macOS (outside the person's control; it also keys availability scopes). */
export const CLAUDE_MANAGED_SETTINGS = "/Library/Application Support/ClaudeCode/managed-settings.json";

export function selectClaudeProductEnvironment(
  value: unknown
): NodeJS.ProcessEnv {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    CLAUDE_ENV_KEYS.flatMap((key) => {
      const entry = source[key];
      return typeof entry === "string" && entry.length > 0
        ? [[key, entry]]
        : [];
    })
  );
}

export function claudeAdapterEnvironment(
  runtime: ResolvedRuntime,
  source: NodeJS.ProcessEnv = process.env
) {
  return {
    ...sanitizedProcessEnvironment(runtime.path, source),
    ...selectClaudeProductEnvironment(source),
    CLAUDE_CODE_EXECUTABLE: runtime.executable,
    CLAUDE_CODE_ARTIFACT_AUTO_OPEN: "0",
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
  } satisfies NodeJS.ProcessEnv;
}

/** 锁版 adapter 经 CLAUDE_CODE_EXECUTABLE 回调用户 CLI。 */
export const claudeAcpLaunch: AcpLauncher = (runtime, overlay) =>
  adapterLaunch("claude-agent-acp", { ...claudeAdapterEnvironment(runtime), ...overlay?.processEnv, CLAUDE_CODE_ARTIFACT_AUTO_OPEN: "0",
    ...(overlay?.session?.disableProviderMemory ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } : {}) });
