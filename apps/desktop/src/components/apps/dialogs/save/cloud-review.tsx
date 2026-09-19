/**
 * [INPUT]: Depends on React, credential-free preload contracts and Apps translations.
 * [OUTPUT]: Loads original conversion attempts and renders pending/confirmed/conflict comparisons with one explicit keep-original action.
 * [POS]: Optional Save dialog detail; stable desktop has no bridge, transport or account dependency.
 */
import { useScopedConversionReview } from "@/components/conversion/review";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ConversionReview } from "../../../../../shared/cloud/conversion/model";
const readReview = (input: { expectedUserId: string; chatId: string }) => window.cloudConversion!.review(input);
export function useConversionReview(chatId: string, receive: (review: ConversionReview | null) => void) {
  const state = useScopedConversionReview(chatId, readReview, receive);
  const keepOriginal = async () => {
    if (!state.review?.candidateHash || state.review.state !== "conflicted" || !state.userId || !window.cloudConversion) throw new Error("APP_PROMOTION_REVIEW_CHANGED");
    await window.cloudConversion.keepOriginal({ expectedUserId: state.userId, chatId, intentId: state.review.intentId, candidateHash: state.review.candidateHash });
    await state.refresh();
  };
  return { ...state, keepOriginal };
}
export function ConversionStatus({ review, busy, keepOriginal }: { review: ConversionReview; busy: boolean; keepOriginal(): void }) {
  const { t } = useAppTranslation();
  const label = (value: ConversionReview["previous"]) => !value ? t("apps.saveAs.cloud.unavailable") :
    value.conversationKind === "ordinary" ? t("apps.saveAs.cloud.ordinary") :
      value.conversationKind === "app-edit" ? t("apps.saveAs.cloud.appEdit") : t("apps.saveAs.cloud.appUse");
  return <div className="flex flex-col gap-3 rounded-md border p-3 text-sm" role="status" aria-live="polite">
    <p>{review.state === "conflicted" ? t("apps.saveAs.cloud.conflict") : review.state === "confirmed" ? t("apps.saveAs.cloud.confirmed") : t("apps.saveAs.cloud.pending")}</p>
    {review.state === "conflicted" && <>
      <dl className="grid grid-cols-2 gap-2">
        <dt className="text-muted-foreground">{t("apps.saveAs.cloud.previous")}</dt><dd>{label(review.previous)}</dd>
        <dt className="text-muted-foreground">{t("apps.saveAs.cloud.current")}</dt><dd>{label(review.current)}</dd>
        <dt className="text-muted-foreground">{t("apps.saveAs.cloud.proposed")}</dt><dd>{label(review.proposed)}</dd>
      </dl>
      <Button className="h-auto whitespace-normal py-2" type="button" variant="outline" disabled={busy} onClick={keepOriginal}>{t("apps.saveAs.cloud.keepOriginal")}</Button>
    </>}
  </div>;
}
