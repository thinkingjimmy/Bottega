/**
 * [INPUT]: Depends on reliable runtime PATH/executable file and process cloud routing environment
 * [OUTPUT]: Provides Claude ACP subsystems with minimal environment, production launcher, sessionId validator and cloud routing whitelist
 * [POS]: The first step is to create a new interface for the Claude backendNo reading, no copying, no rewriting of any credentials or ~/.claude configurations
 */

import { sanitizedProcessEnvironment } from "../runtime-probe";
import type { AcpLauncher, ResolvedRuntime } from "../types";
import { claudeAdapterArgs } from "./adapter-entry";

const SESSION_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export const validateClaudeSessionId = (id: string) => SESSION_PATTERN.test(id);

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
    ELECTRON_RUN_AS_NODE: "1",
    CLAUDE_CODE_EXECUTABLE: runtime.executable,
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
  } satisfies NodeJS.ProcessEnv;
}

/** 锁版 adapter 经 CLAUDE_CODE_EXECUTABLE 回调用户 CLI。 */
export const claudeAcpLaunch: AcpLauncher = (runtime, overlay) => ({
  command: process.execPath,
  args: claudeAdapterArgs(),
  env: { ...claudeAdapterEnvironment(runtime), ...overlay?.processEnv },
});
