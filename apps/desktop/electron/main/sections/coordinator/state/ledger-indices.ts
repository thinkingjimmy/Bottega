/**
 * [INPUT]: Depends on the relay/manual/conversation fields and readonly selector types of the ledger-schema
 * [OUTPUT]: Provides target/conversation Increase indexing, compaction, aftercutting, pending conversation and local reading
 * [POS]: The memory acceleration unit of the coordinator/state; No canonical status, no IO execution
 */

import type {
  LedgerState,
  ManualTurnIntent,
  RelayRecord,
} from "./ledger-schema";
import type { DeepReadonly } from "./readonly-ledger";

export class LedgerIndices {
  private readonly byTargetChat = new Map<string, Set<string>>();
  private readonly byConversation = new Map<string, Set<string>>();

  indexRelay(relay: RelayRecord) {
    const ids =
      this.byTargetChat.get(relay.target.chatId) ?? new Set<string>();
    ids.add(relay.id);
    this.byTargetChat.set(relay.target.chatId, ids);
  }

  indexManual(intent: ManualTurnIntent) {
    const ids =
      this.byConversation.get(intent.conversationId) ?? new Set<string>();
    ids.add(intent.id);
    this.byConversation.set(intent.conversationId, ids);
  }

  rebuild(state: LedgerState) {
    this.byTargetChat.clear();
    this.byConversation.clear();
    for (const relay of Object.values(state.relays)) this.indexRelay(relay);
    for (const intent of Object.values(state.manualIntents)) {
      this.indexManual(intent);
    }
  }

  prune(state: LedgerState) {
    this.pruneMap(this.byTargetChat, state.relays);
    this.pruneMap(this.byConversation, state.manualIntents);
  }

  read<T>(
    state: LedgerState,
    conversationId: string,
    selector: (records: {
      relays: readonly DeepReadonly<RelayRecord>[];
      manualIntents: readonly DeepReadonly<ManualTurnIntent>[];
    }) => T
  ) {
    const relays = [...(this.byTargetChat.get(conversationId) ?? [])]
      .map((id) => state.relays[id])
      .filter((value): value is RelayRecord => Boolean(value));
    const manualIntents = [
      ...(this.byConversation.get(conversationId) ?? []),
    ]
      .map((id) => state.manualIntents[id])
      .filter((value): value is ManualTurnIntent => Boolean(value));
    return selector({ relays, manualIntents });
  }

  pendingConversationIds(state: LedgerState) {
    const ids = new Set<string>();
    for (const [chatId, relayIds] of this.byTargetChat) {
      if (
        [...relayIds].some(
          (relayId) => state.relays[relayId]?.deliveryPhase !== "settled"
        )
      ) {
        ids.add(chatId);
      }
    }
    for (const [conversationId, intentIds] of this.byConversation) {
      if (
        [...intentIds].some((intentId) => {
          const phase = state.manualIntents[intentId]?.phase;
          return phase !== undefined && !["settled", "failed"].includes(phase);
        })
      ) {
        ids.add(conversationId);
      }
    }
    return ids;
  }

  private pruneMap<T>(
    index: Map<string, Set<string>>,
    records: Record<string, T>
  ) {
    for (const [key, ids] of index) {
      for (const id of ids) {
        if (!records[id]) ids.delete(id);
      }
      if (ids.size === 0) index.delete(key);
    }
  }
}
