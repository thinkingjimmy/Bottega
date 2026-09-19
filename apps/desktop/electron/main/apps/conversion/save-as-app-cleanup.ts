/**
 * [INPUT]: Depends on the original Save as App ports, journaled account-cleanup decision and confirmed Base proof.
 * [OUTPUT]: Preserves an uncommitted source or completes confirmed local ownership before account detachment.
 * [POS]: Local conversion settlement; it never delivers network operations or schedules an Agent turn.
 */
import type { SaveAsAppDependencies } from "./save-as-app";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
import { reached } from "../../lifecycle/intent-types";
import type { SagaResult } from "../../lifecycle/admission-gate";
import { preservedConversion, type ConversionScopeCleanup } from "../../lifecycle/scope-cleanup/conversion";
import { allocatedIdentity, isRollbackPhase } from "./save-as-app-support";
import { rollbackSaveAsApp } from "./save-as-app-rollback";

export async function settleSaveForCleanup(deps: SaveAsAppDependencies, original: LifecycleIntent, cleanup: ConversionScopeCleanup): Promise<SagaResult> {
  if (original.kind !== "save-as-app" || original.parentIntentId) throw new Error("CONVERSION_CLEANUP_INTENT_CHANGED");
  const decision = await cleanup.prepare(original), identity = allocatedIdentity(original);
  const chatId = String(original.input.chatId);
  let intent = (await deps.intents.getById(original.intentId))!;
  if (deps.hasActiveTurn(chatId)) throw new Error("CONVERSION_CLEANUP_ACTIVE_TURN");
  if (decision.disposition === "preserve") {
    if (!isRollbackPhase(intent.phase) && reached("save-as-app", intent, "chat-migrated")) throw new Error("CONVERSION_CLEANUP_REQUIRES_CONFIRMED_PROOF");
    await cleanup.release(intent);
    const childId = intent.recoveryState.promotionIntentId;
    if (typeof childId === "string") {
      const child = await deps.intents.getById(childId);
      if (!child || child.parentIntentId !== intent.intentId || child.kind !== "base-promotion") throw new Error("CONVERSION_CLEANUP_CHILD_CHANGED");
      if (!child.terminal) await deps.intents.settle(childId, { status: "rolled-back", error: { code: "CLOUD_SCOPE_DETACHED", message: "Local Base conversion stopped; the original account operation remains retained." } });
    }
    await rollbackSaveAsApp(deps, intent, { chatId }, identity,
      { code: "CLOUD_SCOPE_DETACHED", message: "Local conversion stopped; the original account operation remains retained." }, true);
    return preservedConversion();
  }
  const proof = decision.proof;
  if (!proof || proof.operation.basePromotion?.destination.kind !== "app" ||
      proof.operation.basePromotion.destination.appId !== identity.appId || proof.operation.basePromotion.destination.projectId !== identity.projectId) throw new Error("CONVERSION_CLEANUP_PROOF_CHANGED");
  await cleanup.commit(intent);
  if (!reached("save-as-app", intent, "chat-migrated")) {
    const chat = deps.chats.getMetadata(chatId);
    if (!chat || chat.projectId !== identity.projectId) throw new Error("CONVERSION_CLEANUP_CHAT_CHANGED");
    await deps.rotateSession(chat);
    intent = await deps.intents.advance(intent.intentId, "chat-migrated", { cloudPromotion: proof });
  }
  await deps.promotion.promoteChild({ parent: intent, chatId, projectId: identity.projectId, requestId: identity.promotionRequestId, cloud: proof });
  if (!reached("save-as-app", intent, "promoted")) intent = await deps.intents.advance(intent.intentId, "promoted");
  const hasTurn = Boolean(deps.coordinator.durableTurnPhase(chatId, identity.turnIntentId));
  await deps.store.update(identity.appId, record => ({ ...record, state: "ready", lastError: null,
    skillStatus: hasTurn ? record.skillStatus : { state: "failed", turnIntentId: identity.turnIntentId } }));
  return { status: "done", receipt: { ...decision.receipt, appId: identity.appId } };
}
