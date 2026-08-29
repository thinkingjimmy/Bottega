/**
 * [INPUT]: Depends on shared Codex/chats
 * [OUTPUT]: Provides conversation SubagentRegistry level, source dirty, ledger, terminal-driven settle (turn done → completed, cancelled/error → interrupted), empty return, 128 live draft, sentry, spawn, atomic reservation, boundary hydration/shots and byte budget elimination
 * [POS]: The shared subagent state is a single truth source, main owner and renderer projection shared consumption
 */

import type { AgentTurnItem } from "./agent-ipc";
import {
  applyDelta,
  applyItem,
  createDraft,
  serializeDraft,
  slicePartsProtected,
  type SubagentSettleOutcome,
  type TurnDraft,
} from "./chat-turn-reducer";
import {
  SUBAGENT_BYTE_LIMIT,
  SUBAGENT_DRAFT_LIMIT,
  type ChatPart,
  type PersistedSubagent,
  type PersistedSubagentStatus,
} from "./chats-ipc";
import type {
  AgentLiveSubagent,
  AgentSubagentMeta,
  AgentSubagentStatus,
} from "./agent-ipc";

export { slicePartsProtected } from "./chat-turn-reducer";

const LIVE_SUBAGENT_BYTE_LIMIT = 256 * 1024;
const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const persistedStatusOf: Record<AgentSubagentStatus, PersistedSubagentStatus> = {
  pendingInit: "interrupted",
  running: "interrupted",
  interrupted: "interrupted",
  completed: "completed",
  errored: "errored",
  shutdown: "shutdown",
  notFound: "errored",
};

export const isTerminalSubagentStatus = (status: AgentSubagentStatus) =>
  !["pendingInit", "running"].includes(status);

export type DraftSubagent = {
  meta: AgentSubagentMeta;
  detailState: AgentLiveSubagent["detailState"];
  draft?: TurnDraft;
  persisted?: PersistedSubagent;
  dirty?: boolean;
};

export type DraftReservation =
  | { ok: true; victim?: AgentSubagentMeta }
  | { ok: false };

const shell = (
  agentThreadId: string,
  now: number,
  detailState: AgentLiveSubagent["detailState"]
): DraftSubagent => ({
  meta: {
    agentThreadId,
    name: `Agent ${agentThreadId.slice(0, 8)}`,
    status: "pendingInit",
    spawnedAt: now,
    lastActivityAt: now,
  },
  detailState,
  ...(detailState === "available" ? { draft: createDraft(now) } : {}),
});

const clampDraft = (draft: TurnDraft): TurnDraft => {
  let parts = [...draft.parts];
  const streaming = new Map(draft.streaming);
  while (byteLength({ parts, streaming: [...streaming] }) > LIVE_SUBAGENT_BYTE_LIMIT) {
    if (parts.length) {
      parts = parts.slice(1);
      continue;
    }
    const first = streaming.keys().next().value as string | undefined;
    if (!first) break;
    streaming.delete(first);
  }
  return { ...draft, parts, streaming };
};

export function serializeSubagent(agent: DraftSubagent): PersistedSubagent {
  let parts: ChatPart[];
  if (agent.persisted && !agent.dirty) {
    // 水合只创建有界显示副本；未收到新内容前，落盘仍以原 canonical 为准。
    parts = structuredClone(agent.persisted.parts);
  } else if (agent.draft) {
    const draft = clampDraft(agent.draft);
    const materialized: ChatPart[] = [...draft.parts].map((part) =>
      part.type === "tool" && part.status === "running"
        ? { ...part, status: "failed" as const }
        : (part as ChatPart)
    );
    for (const [itemId, text] of draft.streaming) {
      if (text && !materialized.some((part) => part.itemId === itemId)) {
        materialized.push({ type: "text", itemId, text });
      }
    }
    parts = slicePartsProtected(materialized);
  } else {
    // 128 只限制运行期重型 draft；磁盘已存在的 canonical 详情必须可原样回写。
    parts = structuredClone(agent.persisted?.parts ?? []);
  }
  return {
    meta: {
      ...agent.meta,
      status: persistedStatusOf[agent.meta.status],
    },
    parts,
  };
}

export function hydrateSubagent(agent: PersistedSubagent): DraftSubagent {
  return {
    meta: { ...agent.meta },
    detailState: "available",
    draft: clampDraft({
      startedAt: agent.meta.spawnedAt,
      parts: agent.parts.filter((part) => part.type !== "subagent"),
      streaming: new Map(),
    }),
    persisted: structuredClone(agent),
    dirty: false,
  } as DraftSubagent;
}

export const compareSubagentEviction = (
  left: PersistedSubagent,
  right: PersistedSubagent
) =>
  left.meta.lastActivityAt - right.meta.lastActivityAt ||
  left.meta.agentThreadId.localeCompare(right.meta.agentThreadId);

export function prunePersistedSubagents(
  input: Record<string, PersistedSubagent>
) {
  const result = { ...input };
  const evictedAgentThreadIds: string[] = [];
  const ordered = () =>
    Object.entries(result).sort(([, left], [, right]) =>
      compareSubagentEviction(left, right)
    );
  while (
    byteLength(result) > SUBAGENT_BYTE_LIMIT
  ) {
    const victim = ordered()[0];
    if (!victim) break;
    const [key, agent] = victim;
    delete result[key];
    evictedAgentThreadIds.push(agent.meta.agentThreadId);
  }
  return { subagents: result, evictedAgentThreadIds };
}

export class SubagentRegistry {
  private readonly agents = new Map<string, DraftSubagent>();
  private registryDirty = false;

  constructor(seed: Record<string, PersistedSubagent> = {}) {
    const agents = Object.values(seed).sort((left, right) =>
      right.meta.lastActivityAt - left.meta.lastActivityAt ||
      left.meta.agentThreadId.localeCompare(right.meta.agentThreadId)
    );
    for (const [index, agent] of agents.entries()) {
      this.agents.set(
        agent.meta.agentThreadId,
        index < SUBAGENT_DRAFT_LIMIT
          ? hydrateSubagent(agent)
          : {
              meta: { ...agent.meta },
              detailState: "unavailable",
              persisted: structuredClone(agent),
            }
      );
    }
  }

  upsertMeta(meta: AgentSubagentMeta) {
    const current = this.ensure(meta.agentThreadId, meta.lastActivityAt);
    const next = {
      ...current,
      meta: {
        ...current.meta,
        ...meta,
        status: isTerminalSubagentStatus(current.meta.status)
          ? current.meta.status
          : meta.status,
      },
    };
    this.agents.set(meta.agentThreadId, next);
    this.registryDirty = true;
    return next;
  }

  resume(
    agentThreadId: string,
    patch: Partial<Omit<AgentSubagentMeta, "agentThreadId" | "spawnedAt">> = {},
    now = Date.now()
  ) {
    const current = this.ensure(agentThreadId, now);
    const next = {
      ...current,
      meta: {
        ...current.meta,
        ...patch,
        agentThreadId,
        status: patch.status ?? "running",
        lastActivityAt: now,
      },
    };
    this.agents.set(agentThreadId, next);
    this.registryDirty = true;
    return next;
  }

  applyItem(agentThreadId: string, item: AgentTurnItem, now = Date.now()) {
    const current = this.ensure(agentThreadId, now);
    const next = {
      ...current,
      meta: { ...current.meta, lastActivityAt: now },
      ...(current.draft
        ? {
            draft: clampDraft(applyItem(current.draft, item)),
            dirty: true,
          }
        : {}),
    };
    this.agents.set(agentThreadId, next);
    this.registryDirty = true;
    return next;
  }

  applyDelta(agentThreadId: string, itemId: string, text: string, now = Date.now()) {
    const current = this.ensure(agentThreadId, now);
    const next = {
      ...current,
      meta: { ...current.meta, lastActivityAt: now },
      ...(current.draft
        ? {
            draft: clampDraft(applyDelta(current.draft, itemId, text)),
            dirty: true,
          }
        : {}),
    };
    this.agents.set(agentThreadId, next);
    this.registryDirty = true;
    return next;
  }

  /* `outcome` 是 turn 终态的投影，不是猜测：wire 只在真被打断时才下发子
     agent 终态，所以「turn 善终而它没报终态」= 它跑完了。恒写 interrupted
     会让成功的子 agent 落盘成失败，UI 画红叉（两家来源同病，故修在唯一的
     收敛点，不按来源分支）。默认保守取 interrupted：没有 turn 终态可依。 */
  settle(outcome: SubagentSettleOutcome = "interrupted", now = Date.now()) {
    for (const [id, agent] of this.agents) {
      if (!isTerminalSubagentStatus(agent.meta.status)) {
        this.agents.set(id, {
          ...agent,
          meta: { ...agent.meta, status: outcome, lastActivityAt: now },
        });
        this.registryDirty = true;
      }
    }
    if (!this.registryDirty) return undefined;
    const result = this.persisted();
    this.registryDirty = false;
    return result;
  }

  persisted() {
    const record = Object.fromEntries(
      [...this.agents].map(([id, agent]) => [id, serializeSubagent(agent)])
    );
    return prunePersistedSubagents(record).subagents;
  }

  live(): Record<string, AgentLiveSubagent> {
    return Object.fromEntries(
      [...this.agents].map(([id, agent]) => [
        id,
        {
          meta: structuredClone(agent.meta),
          detailState: agent.detailState,
          ...(agent.draft ? { draft: serializeDraft(agent.draft) } : {}),
        },
      ])
    );
  }

  detailState(agentThreadId: string) {
    return this.agents.get(agentThreadId)?.detailState ?? "unavailable";
  }

  get(agentThreadId: string) {
    const agent = this.agents.get(agentThreadId);
    return agent ? structuredClone(agent.meta) : undefined;
  }

  list() {
    return [...this.agents.values()].map((agent) => structuredClone(agent.meta));
  }

  reserveDraft(agentThreadId: string, now = Date.now()): DraftReservation {
    const current = this.agents.get(agentThreadId);
    if (current?.draft) return { ok: true };
    const live = [...this.agents.entries()].filter(
      ([id, agent]) => id !== agentThreadId && agent.draft
    );
    const victim =
      oldest(live.filter(([, agent]) => agent.persisted && !agent.dirty)) ??
      oldest(
        live.filter(([, agent]) => isTerminalSubagentStatus(agent.meta.status))
      );
    if (!victim && live.length >= SUBAGENT_DRAFT_LIMIT) return { ok: false };
    const victimMeta = victim ? this.demote(victim[0], victim[1]) : undefined;
    const next = current?.persisted
      ? hydrateSubagent(current.persisted)
      : shell(agentThreadId, now, "available");
    this.agents.set(agentThreadId, next);
    if (!current) this.registryDirty = true;
    return {
      ok: true,
      ...(victimMeta ? { victim: victimMeta } : {}),
    };
  }

  private ensure(agentThreadId: string, now: number) {
    const current = this.agents.get(agentThreadId);
    if (current) return current;
    // [deferred#5] meta 永远入册；只给前 128 个 agent 分配重型 draft。
    // 真遇到详情降级抖动或跨代 promotion，再按 dev 边界账本升级。
    const detailState =
      [...this.agents.values()].filter((agent) => agent.draft).length <
      SUBAGENT_DRAFT_LIMIT
        ? "available"
        : "unavailable";
    const next = shell(agentThreadId, now, detailState);
    this.agents.set(agentThreadId, next);
    this.registryDirty = true;
    return next;
  }

  private demote(agentThreadId: string, agent: DraftSubagent) {
    const persisted = serializeSubagent(agent);
    this.agents.set(agentThreadId, {
      meta: { ...agent.meta },
      detailState: "unavailable",
      persisted,
      dirty: false,
    });
    return structuredClone(agent.meta);
  }
}

function oldest(entries: Array<[string, DraftSubagent]>) {
  return entries.sort(
    ([leftId, left], [rightId, right]) =>
      left.meta.lastActivityAt - right.meta.lastActivityAt ||
      leftId.localeCompare(rightId)
  )[0];
}
