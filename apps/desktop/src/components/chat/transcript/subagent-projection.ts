/**
 * [INPUT]: Depends on canonical ChatMessage and renderer ProjectedSubagent
 * [OUTPUT]: Provides EMPTY_SUBAGENTS, commit-only cache store and projectSubagentsByMessage, which generates reusable narrow snippets of the message-referenced agentThreadId
 * [POS]: The Subagent identity isolation layer of the chat/transcript row; The single agent update changes only the message snippet that refers to it
 */

import type { ChatMessage } from "../../../../shared/chats-ipc";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";

export const EMPTY_SUBAGENTS: Record<string, ProjectedSubagent> = Object.freeze(
  {}
);

export type MessageSubagentCache = Map<
  string,
  {
    ids: readonly string[];
    values: readonly (ProjectedSubagent | undefined)[];
    projection: Record<string, ProjectedSubagent>;
  }
>;

export function createMessageSubagentCacheStore() {
  let committed: MessageSubagentCache = new Map();
  return {
    clear() {
      committed = new Map();
    },
    publish(next: MessageSubagentCache) {
      committed = next;
    },
    snapshot() {
      return committed;
    },
  };
}

const referencedAgentIds = (message: ChatMessage) =>
  message.role === "assistant"
    ? [
        ...new Set(
          (message.parts ?? []).flatMap((part) =>
            part.type === "subagent" ? [part.agentThreadId] : []
          )
        ),
      ]
    : [];

export function projectSubagentsByMessage(
  messages: readonly ChatMessage[],
  subagents: Record<string, ProjectedSubagent>,
  previous: MessageSubagentCache = new Map()
) {
  const cache: MessageSubagentCache = new Map();
  const projections = new Map<string, Record<string, ProjectedSubagent>>();
  for (const message of messages) {
    const ids = referencedAgentIds(message);
    if (!ids.length) {
      projections.set(message.id, EMPTY_SUBAGENTS);
      continue;
    }
    const values = ids.map((id) => subagents[id]);
    const prior = previous.get(message.id);
    const stable =
      prior?.ids.length === ids.length &&
      ids.every(
        (id, index) =>
          prior.ids[index] === id && prior.values[index] === values[index]
      );
    const projection = stable
      ? prior.projection
      : Object.fromEntries(
          ids.flatMap((id, index) =>
            values[index] ? [[id, values[index]!]] : []
          )
        );
    cache.set(message.id, { ids, values, projection });
    projections.set(message.id, projection);
  }
  return { cache, projections };
}
