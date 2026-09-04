/**
 * [INPUT]: Depends on React local state, Apps i18n, app-state keys, shared AppOperation/AppRecord, and UI dialog primitives
 * [OUTPUT]: Provides AppProgressDialog with operation-specific live status, cancellable install/update/repair logs, and a non-cancellable deletion surface
 * [POS]: AppsListView progress surface; deletion is projected as its own durable operation instead of falling back to installation semantics
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import type { AppOperation, AppRecord } from "../../../../shared/apps-ipc";
import {
  cancelOperationLabelKey,
  effectiveAppOperation,
  isCancelableOperation,
  isWorkingState,
  progressAriaKey,
  progressTitleKey,
} from "../app-state";
import { useAppTranslation } from "@/components/providers/i18n-provider";

type AppProgressDialogProps = {
  record: AppRecord;
  step?: string;
  operation?: AppOperation;
  logPreview: string;
  onCancel: () => void;
  onShowLog: () => void;
};

export function AppProgressDialog({
  record,
  step,
  operation,
  logPreview,
  onCancel,
  onShowLog,
}: AppProgressDialogProps) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(true);
  const effectiveOperation = effectiveAppOperation(record, operation);
  const deleting = effectiveOperation === "delete";
  return (
    <Dialog
      open={open && isWorkingState(record.state)}
      onOpenChange={setOpen}
    >
      <DialogContent
        className="flex max-h-[calc(100%-2rem)] flex-col gap-4 sm:max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-8">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700">
              <Spinner
                className="size-5"
                aria-label={t(progressAriaKey[effectiveOperation])}
              />
            </span>
            <div className="min-w-0 space-y-1">
              <DialogTitle>{t(progressTitleKey[effectiveOperation])}</DialogTitle>
              <DialogDescription aria-live="polite">
                {step || t(
                  deleting
                    ? "apps.progress.deletingDescription"
                    : "apps.progress.preparing"
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {deleting ? (
          <p
            className="rounded-lg bg-muted px-4 py-3 text-muted-foreground text-sm"
            role="note"
          >
            {t("apps.progress.deletingNotCancellable")}
          </p>
        ) : (
          <>
            <div className="min-h-0 space-y-3">
              <p className="font-medium text-xs">
                {t("apps.progress.latestLog")}
              </p>
              <SlimScroller asChild>
                <pre className="max-h-[min(24rem,50vh)] min-h-36 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap">
                  {logPreview || t("apps.progress.waitingLog")}
                </pre>
              </SlimScroller>
            </div>
            <DialogFooter>
              {isCancelableOperation(effectiveOperation) && (
                <Button size="sm" variant="destructive" onClick={onCancel}>
                  <Trash2 />
                  {t(cancelOperationLabelKey[effectiveOperation])}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  onShowLog();
                }}
              >
                {t("apps.progress.showLog")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
