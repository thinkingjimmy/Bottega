/**
 * [INPUT]: Depends on a TurnRegistry, window subscription broker, activity publisher, image redaction, and optional Project turn projection
 * [OUTPUT]: Provides ordered stamped event publication, state publication, and observed background-promise logging
 * [POS]: Renderer event-delivery boundary for agent-bridge; turn execution and shutdown remain in the bridge root
 */

import type { BrowserWindow } from "electron";
import { AGENT_CHANNEL, type AgentEventBody } from "../../../shared/agent-ipc";
import type { AgentTurn } from "../backends/types";
import { redactImageDetails } from "../gallery/agent-image-projection";
import type { TokenizedSubscriptionBroker } from "../subscription-broker";
import type { TurnRegistry } from "../turn-registry";
import type { AgentActivityPublisher } from "./activity-publisher";
import type {
  AgentBridgeOptions,
  AgentEventPayload,
  BridgeEntry,
} from "./bridge-types";

export function createBridgeEventPublisher(input: {
  turns: TurnRegistry<AgentTurn>;
  subscriptions: TokenizedSubscriptionBroker<BrowserWindow>;
  activity: AgentActivityPublisher<AgentTurn>;
  options(): AgentBridgeOptions | undefined;
}) {
  const publish = (entry: BridgeEntry, body: AgentEventPayload) => {
    const event = input.turns.stamp(entry.conversationId, {
      ...body,
      requestId: entry.requestId,
    } as AgentEventBody);
    input.activity.publish(entry.conversationId);
    const subscription = input.subscriptions.current(entry.conversationId);
    if (!subscription || subscription.isDestroyed()) return event;
    try {
      subscription.webContents.send(AGENT_CHANNEL.event, redactImageDetails(event));
    } catch (cause) {
      console.warn("[agent] event publish failed", cause);
    }
    return event;
  };

  const publishState = (entry: BridgeEntry) => {
    const raw = input.turns.snapshot(entry.conversationId);
    const options = input.options();
    const turn = raw && options?.projectTurnSnapshot
      ? options.projectTurnSnapshot(entry.conversationId, raw)
      : raw;
    if (turn) publish(entry, { type: "turn-state-changed", turn });
    input.activity.publish(entry.conversationId);
  };

  const observe = (promise: Promise<unknown>, context: string) => {
    void promise.catch((cause) => console.error(`[agent] ${context}`, cause));
  };
  return { publish, publishState, observe };
}
