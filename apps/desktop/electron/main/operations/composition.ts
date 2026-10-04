/**
 * [INPUT]: Depends on the broker, the six family adapters, the capability-ref table, the operation registry and the main-process owners they read
 * [OUTPUT]: Provides composeOperations (broker + refs + registry with `operations.query` registered) and the OperationsRuntime type
 * [POS]: The single construction point of the host operation layer; index.ts builds it once after the ledgers exist and hands it to out-of-process hosts
 */
import { z } from "zod";
import { OPERATION_FAMILIES } from "@ai-chat/cloud-protocol/contracts/operations";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import type { ChatStore } from "../chats/chat-store";
import type { RelayLedger } from "../sections/coordinator/relay-ledger";
import type { BaseStore } from "../bases/base-store";
import type { TurnRegistry } from "../agent/turns/turn/turn-registry";
import { OperationBroker } from "./broker";
import { CapabilityRefTable } from "./capability-refs";
import { OperationRegistry } from "./registry";
import { baseToolBatchFamily, chatOperationFamily, cloudReceiptFamily, lifecycleIntentFamily, remoteCommandFamily,
  turnSubmissionFamily, type CloudReceiptPort } from "./families";

export type OperationsRuntime = ReturnType<typeof composeOperations>;

export function composeOperations(owners: { lifecycle: LifecycleIntentStore; chats: ChatStore; ledger: RelayLedger; bases: BaseStore;
  turns: Pick<TurnRegistry, "byRequest">; cloud: () => CloudReceiptPort | null }) {
  const broker = new OperationBroker(), refs = new CapabilityRefTable(), registry = new OperationRegistry(refs);
  broker.register(lifecycleIntentFamily(owners.lifecycle));
  broker.register(chatOperationFamily(owners.chats));
  broker.register(turnSubmissionFamily(owners.ledger));
  broker.register(baseToolBatchFamily(owners.bases));
  broker.register(remoteCommandFamily({ ledger: owners.ledger, store: owners.chats, turns: owners.turns }));
  broker.register(cloudReceiptFamily(owners.cloud));
  registry.register({
    name: "operations.query", risk: "read", principals: ["user-device", "agent-turn", "app-surface"],
    input: z.object({ family: z.enum(OPERATION_FAMILIES), locator: z.unknown() }).strict(),
    handler: async ({ principal }, input) => broker.query(principal, input.family, input.locator),
  });
  return { broker, refs, registry, close: () => refs.revokeAll() };
}
