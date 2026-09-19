/**
 * [INPUT]: Depends on bounded conversion review, the existing Project release API and shared accessible dialog/button primitives.
 * [OUTPUT]: Confirms missing-Project rescue and exposes original-operation status, retry and reviewed conflict abandonment.
 * [POS]: Project sidebar lifecycle dialog; main owns classification, account checks and durable recovery.
 */
import { useCallback, useState } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useScopedConversionReview } from "@/components/conversion/review";
import type { ProjectRescueReview } from "../../../../../shared/cloud/conversion/model";
const readReview = ({ expectedUserId, chatId: projectId }: { expectedUserId: string; chatId: string }) =>
  window.cloudConversion!.rescueReview({ expectedUserId, projectId });
export function ProjectRescueDialog({ projectId, release, onOpenChange }: {
  projectId: string; release(): Promise<number>; onOpenChange(open: boolean): void;
}) {
  const { t } = useAppTranslation();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const receive = useCallback((_review: ProjectRescueReview | null) => {}, []);
  const state = useScopedConversionReview(projectId, readReview, receive), review = state.review;
  const confirm = async () => {
    if (busy || state.checking) return;
    if (state.failed) { await state.refresh(); return; }
    setBusy(true); setFailed(false);
    try { await release(); onOpenChange(false); }
    catch { setFailed(true); await state.refresh(); }
    finally { setBusy(false); }
  };
  const keep = async (item: ProjectRescueReview["items"][number]) => {
    if (busy || !state.userId || !item.candidateHash || !window.cloudConversion) return;
    setBusy(true); setFailed(false);
    try {
      await window.cloudConversion.keepRescueOriginal({ expectedUserId: state.userId, chatId: item.input.chatId,
        intentId: item.intentId, candidateHash: item.candidateHash });
      const next = await state.refresh();
      if (next && !next.items.length && !next.hasMore) onOpenChange(false);
    } catch { setFailed(true); await state.refresh(); }
    finally { setBusy(false); }
  };
  const allConflicted = Boolean(review?.items.length && review.items.every(item => item.state === "conflicted"));
  return <ConfirmationDialog open title={t("projects.rescue.title")} cancelLabel={t("common.cancel")}
    onOpenChange={onOpenChange} busy={busy} confirmDisabled={state.checking || allConflicted && !state.failed}
    confirmLabel={review?.items.length || state.failed ? t("projects.rescue.retry") : t("projects.moveChatsToRoot")}
    onConfirm={() => void confirm()} description={<div className="flex flex-col gap-3 text-sm">
      <p>{t("projects.rescue.description")}</p>
      {!!review?.items.length && <div className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto" aria-live="polite">
        {review.items.map(item => <div key={item.intentId} className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
          <p className="break-words font-medium">{item.title || t("projects.rescue.untitled")}</p>
          <p>{t(item.state === "conflicted" ? "projects.rescue.conflicted" : item.state === "pending" ? "projects.rescue.pending" : "projects.rescue.confirmed")}</p>
          {item.state === "conflicted" && <Button type="button" variant="outline" disabled={busy || state.checking || !item.candidateHash}
            className="h-auto min-h-9 whitespace-normal" onClick={() => void keep(item)}>{t("projects.rescue.keepOriginal")}</Button>}
        </div>)}
        {review.hasMore && <p>{t("projects.rescue.more")}</p>}
      </div>}
      {(failed || state.failed) && <p role="alert" className="text-destructive">{t("projects.rescue.failed")}</p>}
    </div>} />;
}
