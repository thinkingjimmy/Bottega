/**
 * [INPUT]: Depends on existing Base promotion, the optional conversion review hook and shared dialog/i18n primitives.
 * [OUTPUT]: Provides restartable Project Base promotion confirmation with visible errors and reviewed conflict abandonment.
 * [POS]: Desktop Base header dialog; fixed main IPC owns conversion, account checks and local data disposition.
 */
import { useCallback, useRef, useState } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { useScopedConversionReview } from "@/components/conversion/review";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BasePromotionReceipt } from "../../../../../shared/bases-ipc";
import type { ProjectPromotionReview } from "../../../../../shared/cloud/conversion/model";
const readReview = (input: { expectedUserId: string; chatId: string }) => window.cloudConversion!.projectReview(input);
export function ProjectPromotionDialog({ chatId, promote, onOpenChange, onPromoted }: {
  chatId: string; promote(input: { chatId: string; requestId: string }): Promise<BasePromotionReceipt>;
  onOpenChange(open: boolean): void; onPromoted(receipt: BasePromotionReceipt): void;
}) {
  const { t } = useAppTranslation(), attempt = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const receive = useCallback((review: ProjectPromotionReview | null) => { attempt.current = review?.input.requestId ?? null; }, []);
  const state = useScopedConversionReview(chatId, readReview, receive), review = state.review;
  const confirm = async () => {
    if (busy || state.checking) return;
    if (state.failed) { await state.refresh(); return; }
    setBusy(true); setFailed(false);
    attempt.current ??= crypto.randomUUID();
    try {
      const receipt = await promote({ chatId, requestId: attempt.current });
      attempt.current = null; onOpenChange(false); onPromoted(receipt);
    } catch {
      setFailed(true);
      if (!window.cloudConversion) attempt.current = null;
      await state.refresh();
    } finally { setBusy(false); }
  };
  const keepOriginal = async () => {
    if (!review?.candidateHash || !state.userId || !window.cloudConversion || busy) return;
    setBusy(true); setFailed(false);
    try {
      await window.cloudConversion.keepProjectOriginal({ expectedUserId: state.userId, chatId, intentId: review.intentId, candidateHash: review.candidateHash });
      attempt.current = null; onOpenChange(false);
    } catch { setFailed(true); await state.refresh(); }
    finally { setBusy(false); }
  };
  return <ConfirmationDialog open cancelLabel={t("common.cancel")} title={t("bases.header.promoteTitle")} onOpenChange={onOpenChange}
    busy={busy} confirmDisabled={state.checking || review?.state === "conflicted" && !review.candidateHash}
    confirmLabel={review?.state === "conflicted" ? t("bases.promotion.keepOriginal") : review || state.failed ? t("bases.promotion.retry") : t("bases.header.promoteConfirm")}
    onConfirm={() => void (review?.state === "conflicted" ? keepOriginal() : confirm())}
    description={<div className="flex flex-col gap-3 text-sm">
      <p>{t("bases.header.promoteDescription")}</p>
      {review && <p role="status" aria-live="polite">{review.state === "conflicted" ? t("bases.promotion.conflict") :
        review.state === "confirmed" ? t("bases.promotion.confirmed") : t("bases.promotion.pending")}</p>}
      {(failed || state.failed) && <p role="alert" className="text-destructive">{t("bases.promotion.failed")}</p>}
    </div>} />;
}
