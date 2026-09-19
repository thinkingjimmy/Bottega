/**
 * [INPUT]: Depends on canonical ChatMessage and renderer ProjectedSubagent
 * [OUTPUT]: Provides EMPTY_SUBAGENTS and createMessageSubagentProjector: one row's narrow, memoized slice of the Subagent table, projected only for rows that render
 * [POS]: The Subagent identity isolation layer of the chat/transcript row; a single agent update changes only the rows that name it
 */

import type { ChatMessage } from "../../../../shared/chats-ipc";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";

export const EMPTY_SUBAGENTS: Record<string, ProjectedSubagent> = Object.freeze(
  {}
);

type MessageSubagentEntry = {
  ids: readonly string[];
  values: readonly (ProjectedSubagent | undefined)[];
  projection: Record<string, ProjectedSubagent>;
};

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

/**
 * Projects one row at a time, because the timeline reader — not this host — owns the visible
 * window: only the rows it renders ever reach `project`, so a conversation with thousands of
 * loaded messages still projects the few dozen on screen. Each row's slice is memoized on the
 * exact agents it names, so another agent's update never changes this row's props.
 */
export function createMessageSubagentProjector() {
  const cache = new Map<string, MessageSubagentEntry>();
  return {
    project(
      message: ChatMessage,
      subagents: Record<string, ProjectedSubagent>
    ): Record<string, ProjectedSubagent> {
      const ids = referencedAgentIds(message);
      if (!ids.length) {
        cache.delete(message.id);
        return EMPTY_SUBAGENTS;
      }
      const values = ids.map((id) => subagents[id]);
      const prior = cache.get(message.id);
      const stable =
        prior?.ids.length === ids.length &&
        ids.every(
          (id, index) =>
            prior.ids[index] === id && prior.values[index] === values[index]
        );
      if (stable) return prior.projection;
      const projection = Object.fromEntries(
        ids.flatMap((id, index) => (values[index] ? [[id, values[index]!]] : []))
      );
      cache.set(message.id, { ids, values, projection });
      return projection;
    },
    /** Rows the transcript no longer holds — truncated, revised, or clamped out of the window — stop being remembered. */
    retain(messages: readonly ChatMessage[]) {
      if (!cache.size) return;
      const live = new Set(messages.map((message) => message.id));
      for (const id of [...cache.keys()]) {
        if (!live.has(id)) cache.delete(id);
      }
    },
  };
}
