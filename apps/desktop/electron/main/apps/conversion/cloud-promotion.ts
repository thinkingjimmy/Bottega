/**
 * [INPUT]: Depends on the lifecycle intent, fixed conversion identities and confirmed Base ownership proof.
 * [OUTPUT]: Defines the injected receipt-first App conversion port.
 * [POS]: Domain boundary for Save as App; stable builds require no cloud runtime or network client.
 */
import type { ConfirmedBasePromotion } from "../../bases/store/promotion/cloud";
import type { ChatMetadata } from "../../chats/chat-summary";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
import type { SaveIdentity } from "./save-as-app-support";
export type SaveCloudPromotionInput = {
  intent: LifecycleIntent; identity: SaveIdentity; chat: ChatMetadata; name: string;
};
export interface SaveCloudPromotion {
  prepare(input: SaveCloudPromotionInput): Promise<ConfirmedBasePromotion | null>;
  commit(proof: ConfirmedBasePromotion): Promise<void>;
  adopt(proof: ConfirmedBasePromotion): Promise<void>;
  discard(intent: LifecycleIntent, candidateHash: string, recordDecision: () => Promise<void>): Promise<void>;
}
