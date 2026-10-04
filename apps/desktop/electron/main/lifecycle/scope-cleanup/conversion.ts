/**
 * [INPUT]: Depends on the original lifecycle intent and validated Base promotion proof.
 * [OUTPUT]: Provides local-only conversion settlement ports and explicit preservation outcomes for reviewed account cleanup.
 * [POS]: Domain contract shared by conversion sagas; it grants no transport or account authority.
 */
import type { ConfirmedBasePromotion } from "../../bases/store/promotion/cloud";
import type { LifecycleIntent } from "../intent-types";
import type { SagaResult } from "../admission-gate";

export const preservedConversion = (): SagaResult => ({ status: "business-rejected", error: {
  code: "CLOUD_SCOPE_DETACHED", message: "Local conversion stopped. The original account operation remains retained; its cloud outcome was not changed.",
} });

export type ConversionCleanupDecision = {
  disposition: "preserve" | "complete";
  proof?: ConfirmedBasePromotion;
  receipt: Record<string, unknown>;
};
export interface ConversionScopeCleanup {
  prepare(intent: LifecycleIntent): Promise<ConversionCleanupDecision>;
  commit(intent: LifecycleIntent): Promise<void>;
  release(intent: LifecycleIntent): Promise<void>;
}
