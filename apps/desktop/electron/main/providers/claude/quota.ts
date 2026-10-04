/**
 * [INPUT]: Depends on the Claude adapter environment, the bridged quota channel and the reader's one-shot adapter.
 * [OUTPUT]: Provides claudeQuotaLaunch (the control-session CLI main launches sealed for host custody) and claudeQuota, Claude's
 *           QuotaHook: bridged, kept warm (the CLI takes 2.5 s to start), and auth-blind — get_usage answers
 *           rate_limits_available: false both when logged out and when the plan has no limits; its route and settings file come from auth.ts.
 * [POS]: Claude's half of TASK-13 B, carried by claudeBackend; the bridge speaks the protocol (usage-limits/readers/exchange.ts).
 */
import type { ResolvedRuntime } from "../../backends/types";
import { bridgedQuotaChannel } from "../host/turns/bridged-quota";
import { readOnce, type QuotaHook } from "../../usage-limits/readers/common";
import { claudeAdapterEnvironment } from "./environment";
import { claudeRoute, claudeSettingsPath } from "./auth";

/* The exact argument list the Agent SDK passed for this session (captured from 0.3.232): stream-json both ways, no
   tools, no settings sources, strict (empty) MCP, dontAsk, no session file, safe mode, no Chrome, hooks and auto-memory off. */
const CONTROL_ARGS = ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--tools", "",
  "--setting-sources=", "--strict-mcp-config", "--permission-mode", "dontAsk", "--no-session-persistence", "--safe-mode",
  "--no-chrome", "--settings", JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false })];

export const claudeQuotaLaunch = (runtime: ResolvedRuntime, cwd: string) => ({ command: runtime.executable, args: CONTROL_ARGS, cwd,
  env: { ...claudeAdapterEnvironment(runtime), CLAUDE_CODE_ENTRYPOINT: "sdk-ts" } });

const channel = bridgedQuotaChannel(claudeQuotaLaunch);
export const claudeQuota: QuotaHook = { kind: "bridged", read: readOnce(channel), channel, authBlind: true, route: claudeRoute, routeConfig: claudeSettingsPath };
