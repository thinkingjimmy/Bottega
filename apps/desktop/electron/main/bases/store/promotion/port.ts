/**
 * [INPUT]: Depends on lifecycle intent identity and confirmed Base ownership receipts.
 * [OUTPUT]: Defines an injected Project promotion port and a lock-external delivery continuation.
 * [POS]: Domain conversion boundary shared by Base promotion and Save as App; no network client is imported.
 */
import type { LifecycleIntent } from "../../../lifecycle/intent-types";
import type { ConfirmedBasePromotion } from "./cloud";
export type ProjectBasePromotionInput = { intent: LifecycleIntent; chatId: string; projectId: string };
export interface ProjectBasePromotion {
  prepare(input: ProjectBasePromotionInput): Promise<ConfirmedBasePromotion | null>;
  commit(proof: ConfirmedBasePromotion): Promise<void>;
  discard(intent: LifecycleIntent, candidateHash: string, recordDecision: () => Promise<void>): Promise<void>;
}
export class CloudPromotionDelivery extends Error {
  constructor(readonly deliver: () => Promise<void>) { super("CLOUD_PROMOTION_DELIVERY_REQUIRED"); }
}
