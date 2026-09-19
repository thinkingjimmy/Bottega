/**
 * [INPUT]: Persisted bodies and the verified live turn projection.
 * [OUTPUT]: Unique subagent projections with deterministic status groups and summaries.
 * [POS]: conversation/subagents' read-model merge; source provenance never substitutes for execution status.
 */
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import type { ConversationModel } from "../body/model";
export type SubagentProjection = LiveProjection["subagents"][number] & { body?: ConversationModel["bodies"][number] };
export const isActiveSubagent = (agent: Pick<SubagentProjection, "meta">) => ["pendingInit", "running"].includes(agent.meta.status);
export function mergeSubagents(model: Pick<ConversationModel, "bodies" | "live" | "canonicalReady">): SubagentProjection[] {
  const result = new Map<string, SubagentProjection>();
  for (const body of model.bodies) {
    if (body.message.segment === "imported") continue;
    for (const agent of Object.values(body.subagents ?? {})) {
      const previous = result.get(agent.meta.agentThreadId);
      if (!previous || agent.meta.lastActivityAt >= previous.meta.lastActivityAt) result.set(agent.meta.agentThreadId,
        { meta: agent.meta, detailState: "available", draft: { parts: agent.parts, streaming: [], startedAt: agent.meta.spawnedAt }, body });
    }
  }
  const live = model.live;
  if (live && !model.canonicalReady && !(live.state?.receipt.settlementState === "settled" && live.state.receipt.resultKind === "empty")) {
    const running = live.state?.receipt.settlementState === "open" && live.projection?.terminal === null;
    for (const agent of live.projection?.subagents ?? []) {
      const previous = result.get(agent.meta.agentThreadId);
      if (!previous || running || agent.meta.lastActivityAt > previous.meta.lastActivityAt) result.set(agent.meta.agentThreadId, agent);
    }
  }
  return [...result.values()].sort((a, b) => b.meta.lastActivityAt - a.meta.lastActivityAt || a.meta.agentThreadId.localeCompare(b.meta.agentThreadId));
}
export function groupSubagents(agents: readonly SubagentProjection[]) {
  const ordered = [...agents].sort((a, b) => b.meta.lastActivityAt - a.meta.lastActivityAt || a.meta.agentThreadId.localeCompare(b.meta.agentThreadId));
  return { active: ordered.filter(isActiveSubagent), done: ordered.filter(agent => !isActiveSubagent(agent)) };
}
