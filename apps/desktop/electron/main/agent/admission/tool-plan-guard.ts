/**
 * [INPUT]: Depends on the shared third-party MCP plan, the Agent send payload's SessionRef, and the hydrated Project Tools receipt.
 * [OUTPUT]: Provides assertThirdPartyMcpPlanBinding, the pure pre-spawn guard that a resolved plan still serves the prepared Project context and, on resume, the plan the session recorded.
 * [POS]: apps/desktop/electron/main/agent/admission; agent/ bridge collaborator; agent-bridge.ts calls it once per spawn attempt, after the plan is resolved and before any connection claim or custody entry.
 */

import type { AgentSendPayload } from "../../../../shared/ipc/agent/agent-ipc";
import type { ThirdPartyMcpPlan } from "../../../../shared/ipc/settings/mcp-servers-ipc";
import type { HydratedProjectTools } from "../../sections/coordinator/admission/prepared-project-tools";

export function assertThirdPartyMcpPlanBinding(
  plan: ThirdPartyMcpPlan,
  preparedProjectTools: HydratedProjectTools | undefined,
  session: AgentSendPayload["session"]
) {
  const preparedContext = preparedProjectTools?.receipt.projectContext;
  if (
    preparedContext &&
    (preparedContext.projectId !== plan.projectContext.projectId ||
      preparedContext.projectLifecycleRevision !==
        plan.projectContext.projectLifecycleRevision)
  ) {
    throw new Error("PROJECT_TOOLS_PLAN_CONTEXT_MISMATCH");
  }
  if (session) {
    const binding = session.toolPlan;
    if (
      !binding ||
      binding.planDigest !== plan.planDigest ||
      binding.projectId !== plan.projectContext.projectId
    ) {
      throw new Error("SESSION_TOOL_PLAN_STALE");
    }
  }
}
