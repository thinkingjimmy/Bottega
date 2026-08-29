/**
 * [INPUT]: Depends on ACP ClientCapabilities and the product backend capability policy
 * [OUTPUT]: Provides the single ACP initialize clientCapabilities builder and backend policy grid
 * [POS]: The ACP session negotiation policy source shared by production turns, readiness probes, and deep handshakes
 */

import type { ClientCapabilities } from "@agentclientprotocol/sdk";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";

export type SessionCapabilityPolicy = Readonly<{
  plan: boolean;
  elicitation: "form" | "disabled";
  terminalAuth: boolean;
}>;

export const SESSION_CAPABILITY_POLICY: Readonly<
  Record<AgentBackendId, SessionCapabilityPolicy>
> = {
  codex: { plan: true, elicitation: "form", terminalAuth: false },
  claude: { plan: false, elicitation: "form", terminalAuth: false },
  kimi: { plan: false, elicitation: "form", terminalAuth: false },
  opencode: { plan: false, elicitation: "form", terminalAuth: true },
};

export function buildAcpClientCapabilities(
  policy: SessionCapabilityPolicy
): ClientCapabilities {
  return {
    /* 不声明 `session.configOptions.boolean` 是**有意的**，不是遗漏：一旦声明，
       两家 adapter 会把 fast 档从 select 换成 `type:"boolean"`，而消费侧的
       `selectConfig`（`session/config.ts`）与 `optionalServiceTierConfig` 都只
       认 `type === "select"` ⇒ Speed 会静默失效（找不到 = 能力缺席，不报错）。
       要声明必须**先**改这两处消费，让通道匹配器按 `type` 分发；账见 L12。 */
    session: { configOptions: {} },
    ...(policy.plan ? { plan: {} } : {}),
    ...(policy.elicitation === "form"
      ? { elicitation: { form: {} } }
      : {}),
    ...(policy.terminalAuth
      ? { _meta: { "terminal-auth": true } }
      : {}),
  };
}
