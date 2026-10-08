/**
 * [INPUT]: Shared queue controller, visible successor identities and localized composer copy.
 * [OUTPUT]: Desktop queue rows with capability-gated edit/Steer, confirmed reorder feedback and pause recovery.
 * [POS]: Presentation-only remote queue surface; all custody and effects belong to the shared controller.
 */
import type { RemoteQueueController } from "../../../platform/remote/queue/controller";
import { MessageQueuePanel } from "../../composer/queue/message-queue-panel";
import { useComposerTranslation } from "../../composer/controls/copy/translation";
import { remoteCopy } from "../../../i18n/messages/remote";
import { reasonCopy } from "./receipts";
export function RemoteQueue({ controller, locale, disabled, visibleIds }: {
  controller: RemoteQueueController; locale: string; disabled: boolean; visibleIds: readonly string[];
}) {
  const t = useComposerTranslation(locale), copy = remoteCopy(locale), state = controller.snapshot();
  const operations = controller.store.snapshot().queueOperations ?? [];
  const rows = controller.rows().filter(row => visibleIds.includes(row.intentId) || operations.some(op => op.originalId === row.intentId));
  const items = rows.map(row => {
    const value = controller.draft(row.intentId), pending = operations.some(op => op.originalId === row.intentId);
    const payload = controller.session.snapshot().entries.find(entry => entry.input.commandId === row.intentId)?.input.payload;
    return { id: row.intentId, prompt: { displayText: value?.text || (payload && "text" in payload ? payload.text : "") || copy.draft },
      state: state.busy || disabled || row.locked || pending ? "submitting" as const : "queued" as const,
      readOnlyEdit: !controller.canEdit(row), readOnlySteer: !controller.own(row),
      ...(pending && !state.busy ? { note: copy.receiptUnknown } : {}) };
  });
  const pausedReason = controller.store.snapshot().local?.paused;
  const error = state.error && reasonCopy(state.error, copy);
  return <MessageQueuePanel t={t} items={items} paused={controller.paused} steerSupported={controller.steerSupported}
    canSteer={item => { const row = rows.find(row => row.intentId === item.id); return Boolean(row && controller.canSteer(row)); }}
    queueError={error ?? (pausedReason && !["cancelled", "queue-restored"].includes(pausedReason) ? reasonCopy(pausedReason, copy) : null)}
    onRemove={id => { void controller.remove(id); }} onMove={(from, to) => controller.move(rows.map(row => row.intentId), from, to)}
    onEdit={id => { void controller.edit(id); }} onSteer={id => { void controller.steer(id); }} onResume={() => { void controller.resume(); }}
    onDismissError={controller.dismiss} onResendAmbiguous={() => {}} onRemoveAmbiguous={() => {}} onReorderLock={controller.lock} />;
}
