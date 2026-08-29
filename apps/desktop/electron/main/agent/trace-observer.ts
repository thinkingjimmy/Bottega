/**
 * [INPUT]: Depends on TurnRegistry draft observations and the turn-owned ACP trace writer
 * [OUTPUT]: Provides opt-in draft trace installation, including item removal events
 * [POS]: Adapter between generic registry observations and ACP generation trace records
 */

import type { AgentTurn } from "../backends/types";
import { acpTraceEnabled } from "../backends/acp/trace";
import type { TurnRegistry } from "../turn-registry";
import type { BridgeEntry } from "./bridge-types";

export function installAcpDraftTrace(turns: TurnRegistry<AgentTurn>) {
  if (!acpTraceEnabled()) return;
  turns.setDraftObserver((entry, observation) => {
    const trace = (entry as BridgeEntry).trace;
    if (!trace) return;
    const record =
      observation.type === "item"
        ? { type: "item" as const, item: observation.item, draft: entry.draft }
        : {
            type: observation.type,
            itemId: observation.itemId,
            draft: entry.draft,
          };
    trace.recordDraft(entry.generation, record);
  });
}
