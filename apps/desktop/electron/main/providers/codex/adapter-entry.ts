/**
 * [INPUT]: Depends on node createRequire, locked @agentclientprotocol/codex-acp, local builtin server spec, frozen third-party plan and shared timeout contract
 * [OUTPUT]: Provides codexAcpEntry/codexAcpArgs, production launcher (the bundled Node through the runtime port's adapterLaunch, TASK-35), the sessionId validator (re-exported from turn-config) and explicit CODEX_PATH/CODEX_CONFIG; builtin/third-party servers share one bounded config, plus the Codex plugin's changed settings (memory, native subagents) and a workflow role's memory off (disableProviderMemory; T-P5, T-D08)
 * [POS]: Boundary of the Codex ACP supply chain; resolves only from the installed lockfile entry, never falls back to npx or a network install
 */

import { createRequire } from "node:module";
import { codexEnvironment } from "./environment";
import { adapterLaunch } from "../../runtime";
import type { AcpLauncher, ResolvedRuntime } from "../../backends/types";
import type { BuiltinMcpServerSpec } from "../../tools/lease";
import { BUILTIN_CLIENT_TIMEOUT_MS } from "../../../../shared/builtin-tools";
import {
  assertUniqueMcpBackendAliases,
  type ThirdPartyMcpPlan,
} from "../../../../shared/ipc/settings/mcp-servers-ipc";

const require = createRequire(import.meta.url);
/* The validator lives in the launch-independent turn config, so the provider bridge reaches it without the runtime port. */
export { validateCodexSessionId } from "./turn-config";

export function codexAcpEntry() {
  return require.resolve("@agentclientprotocol/codex-acp");
}

export function codexAcpArgs() {
  return [codexAcpEntry()];
}

export function codexAcpEnvironment(
  runtime: ResolvedRuntime,
  options: {
    artifactDirectory?: string;
    approveForMe?: boolean;
    disableProviderMemory?: boolean;
    builtinMcp?: BuiltinMcpServerSpec;
    thirdPartyMcpPlan?: ThirdPartyMcpPlan;
  } = {}
) {
  return {
    ...codexEnvironment(runtime),
    CODEX_PATH: runtime.executable,
    CODEX_CONFIG: codexConfig(options),
  } satisfies NodeJS.ProcessEnv;
}

/* T-D08 / T-P5: a workflow role's memory is always off (disableProviderMemory); a changed plugin setting adds its own key; defaults send
   nothing. `features` is one object, so a workflow role without native subagents keeps both. */
const codexPluginOverrides = (options: { disableProviderMemory?: boolean; providerSettings?: Readonly<Record<string, boolean | string | number>> }) => {
  const memoryOff = options.disableProviderMemory || options.providerSettings?.memory === false;
  const subagentsOff = options.providerSettings?.["native-subagents"] === false;
  const features = { ...(options.disableProviderMemory ? { memories: false } : {}), ...(subagentsOff ? { multi_agent: false } : {}) };
  return {
    ...(Object.keys(features).length ? { features } : {}),
    ...(memoryOff ? { memories: { generate_memories: false, use_memories: false } } : {}),
    ...(subagentsOff ? { agents: { max_concurrent_threads_per_session: 1 } } : {}),
  };
};

function codexConfig(options: {
  artifactDirectory?: string;
  approveForMe?: boolean;
  disableProviderMemory?: boolean;
  builtinMcp?: BuiltinMcpServerSpec;
  thirdPartyMcpPlan?: ThirdPartyMcpPlan;
  providerSettings?: Readonly<Record<string, boolean | string | number>>;
}) {
  assertUniqueMcpBackendAliases(options.thirdPartyMcpPlan?.entries ?? []);
  const thirdParty = Object.fromEntries(
    (options.thirdPartyMcpPlan?.entries ?? []).map((server) => [
      server.backendAlias,
      server.transport === "stdio"
        ? {
            command: server.command,
            args: server.args,
            env: server.env,
            ...(server.cwd ? { cwd: server.cwd } : {}),
          }
        : {
            url: server.url,
            ...(Object.keys(server.headers).length
              ? { http_headers: server.headers }
              : {}),
          },
    ])
  );
  const serialized = JSON.stringify({
    ...(options.artifactDirectory ? { sandbox_workspace_write: { writable_roots: [options.artifactDirectory] } } : {}),
    approvals_reviewer: options.approveForMe ? "auto_review" : "user",
    ...codexPluginOverrides(options),
    ...(options.builtinMcp || Object.keys(thirdParty).length
      ? {
          mcp_servers: {
            ...thirdParty,
            ...(options.builtinMcp
              ? {
                  [options.builtinMcp.name]: {
                    command: options.builtinMcp.command,
                    args: options.builtinMcp.args,
                    env: options.builtinMcp.env,
                    tool_timeout_sec: BUILTIN_CLIENT_TIMEOUT_MS / 1000,
                  },
                }
              : {}),
          },
        }
      : {}),
  });
  if (Buffer.byteLength(serialized, "utf8") > 96 * 1024) {
    throw new Error("Codex session 配置超过安全的环境字节预算");
  }
  return serialized;
}

/** 锁版 adapter 再按 CODEX_PATH 二次 spawn 用户 CLI。 */
export const codexAcpLaunch: AcpLauncher = (runtime, overlay) => adapterLaunch("codex-acp", {
    ...codexEnvironment(runtime),
    CODEX_PATH: runtime.executable,
    ...overlay?.processEnv,
    /* 产品冻结的 MCP 配置必须最后写入；App env 不能覆盖能力判决。 */
    CODEX_CONFIG: codexConfig(overlay?.session ?? {}),
});
