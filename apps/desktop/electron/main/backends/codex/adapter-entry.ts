/**
 * [INPUT]: Depends on node createRequire, lock @agentclientprotocol/codex-acp, local builtin server spec, main Freeze third-party plan/product Skill rules and shared overtime authentication
 * [OUTPUT]: Provides codexAcpEntry/codexAcpArgs, a production launcher, sessionId validator and an explicit CODEX_PATH/CODEX_CONFIG environment; builtin/third-party server/Skill rules are inserted by the same config, repeated alias rejected before sequencing, and the entire package is 96KiB
 * [POS]: the borders of the Codex ACP supply chain; Only parse the lockfile. The input is installed, prohibiting npx/ network back-up
 */

import { createRequire } from "node:module";
import { codexEnvironment } from "../../codex-runtime";
import type { AcpLauncher, ResolvedRuntime } from "../types";
import type { BuiltinMcpServerSpec } from "../../tools/lease";
import { BUILTIN_CLIENT_TIMEOUT_MS } from "../../../../shared/builtin-tools";
import {
  assertUniqueMcpBackendAliases,
  type ThirdPartyMcpPlan,
} from "../../../../shared/mcp-servers-ipc";

const require = createRequire(import.meta.url);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateCodexSessionId = (id: string) => UUID_PATTERN.test(id);

export function codexAcpEntry() {
  return require.resolve("@agentclientprotocol/codex-acp");
}

export function codexAcpArgs() {
  return [codexAcpEntry()];
}

export function codexAcpEnvironment(
  runtime: ResolvedRuntime,
  options: {
    approveForMe?: boolean;
    builtinMcp?: BuiltinMcpServerSpec;
    thirdPartyMcpPlan?: ThirdPartyMcpPlan;
    skillRules?: readonly Readonly<{ path: string; enabled: false }>[];
  } = {}
) {
  return {
    ...codexEnvironment(runtime),
    ELECTRON_RUN_AS_NODE: "1",
    CODEX_PATH: runtime.executable,
    CODEX_CONFIG: codexConfig({
      approveForMe: options.approveForMe,
      builtinMcp: options.builtinMcp,
      thirdPartyMcpPlan: options.thirdPartyMcpPlan,
      skillRules: options.skillRules,
    }),
  } satisfies NodeJS.ProcessEnv;
}

function codexConfig(options: {
  approveForMe?: boolean;
  builtinMcp?: BuiltinMcpServerSpec;
  thirdPartyMcpPlan?: ThirdPartyMcpPlan;
  skillRules?: readonly Readonly<{ path: string; enabled: false }>[];
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
    approvals_reviewer: options.approveForMe ? "auto_review" : "user",
    ...(options.skillRules?.length
      ? { skills: { config: options.skillRules.map((rule) => ({ ...rule })) } }
      : {}),
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
export const codexAcpLaunch: AcpLauncher = (runtime, overlay) => ({
  command: process.execPath,
  args: codexAcpArgs(),
  env: {
    ...codexEnvironment(runtime),
    ELECTRON_RUN_AS_NODE: "1",
    CODEX_PATH: runtime.executable,
    ...overlay?.processEnv,
    /* 产品冻结的 MCP 配置必须最后写入；App env 不能覆盖能力判决。 */
    CODEX_CONFIG: codexConfig({
      approveForMe: overlay?.session?.approveForMe,
      builtinMcp: overlay?.session?.builtinMcp,
      thirdPartyMcpPlan: overlay?.session?.thirdPartyMcpPlan,
      skillRules: overlay?.session?.skillRules,
    }),
  },
});
