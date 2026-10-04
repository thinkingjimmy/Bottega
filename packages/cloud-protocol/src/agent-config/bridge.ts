/**
 * [INPUT]: Depends only on types: the Agent-configuration payload, producer class and guarantee.
 * [OUTPUT]: Provides AGENT_CONFIG_CHANNEL, the AgentConfigView type (a configuration as the interface shows it, with its effective guarantees and any partial apply on this computer) and the AgentConfigBridge interface the renderer calls.
 * [POS]: The one IPC contract between the desktop main process (electron/main/agent-configs) and any interface (TASK-21 list, New config dialog, workflow step picker); a fake implements the same interface. Type-only apart from the channel names, so the preload bundles no schema.
 */
import type { Guarantee } from "./guarantees";
import type { ProducerClass } from "./model";
import type { AgentConfigPayload } from "./payload";
import type { ConfigApplySetting } from "@bottega/contracts/workflow/bridge";

export const AGENT_CONFIG_CHANNEL = Object.freeze({ list: "agent-configs:list", offeredIn: "agent-configs:offered-in", create: "agent-configs:create",
  update: "agent-configs:update", enable: "agent-configs:enable", remove: "agent-configs:remove", changed: "agent-configs:changed" } as const);
/**
 * `pending` is true only while an account can receive this computer's edits and one has not reached it yet. Signed out,
 * `localOnly` is true and nothing is pending: there is nowhere to sync to, so the interface shows no sync state.
 * `guarantees` is null for a deleted configuration. The Read-only badge shows only for `workspace.state === "enforced"`;
 * a requested guarantee that is `unsupported` or `unverified` is "needs attention" with its reason.
 */
export type AgentConfigView = { configId: string; revision: number; payload: AgentConfigPayload | null; producerClass: ProducerClass; deleted: boolean;
  pending: boolean; localOnly: boolean; conflicted: boolean;
  /** Why this computer's edit cannot reach the account: it is at its configuration budget. It is sent again by itself once
      a deletion frees a slot. Never set while local-only. */
  syncIssue: "budget" | null;
  /** Why it cannot be chosen right now: its Provider's plugin is turned off (Q29). */
  unavailable: "provider-disabled" | null; guarantees: { workspace: Guarantee; network: Guarantee } | null;
  /** T21-c: the last check on this computer found some of its settings would not take effect (a workflow role is refused until
      they do); null once they all apply, and for any edited version. */
  applyIssue: { kind: "partial"; settings: readonly ConfigApplySetting[] } | null };
/**
 * Writes reject with an Error whose message is a stable code: `agent-config-not-found`, `agent-config-deleted`,
 * `agent-config-budget`, `agent-config-invalid` (the payload failed the schema).
 */
export interface AgentConfigBridge {
  list(): Promise<AgentConfigView[]>;
  /** Live, not deleted, offered in this Project's pickers (Available in). */
  offeredIn(projectId: string): Promise<AgentConfigView[]>;
  create(payload: AgentConfigPayload): Promise<AgentConfigView>;
  update(configId: string, payload: AgentConfigPayload): Promise<AgentConfigView>;
  /** Turns a draft from a phone or browser into a runnable configuration. */
  enable(configId: string): Promise<AgentConfigView>;
  remove(configId: string): Promise<AgentConfigView>;
  onChanged(listener: () => void): () => void;
}
