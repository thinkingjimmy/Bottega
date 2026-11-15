/**
 * [INPUT]: Depends on Main-held local/account deletion impact, original lifecycle commands and existing accessible Dialog/Settings primitives.
 * [OUTPUT]: Provides WidgetUninstallDialog for distinct local uninstall/account deletion confirmation, original-operation lookup/retry and honest partial completion.
 * [POS]: Custody management UI; source, layout, package paths and cleanup authority stay with Main.
 */
import { useRef, useState } from "react";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { AppDialogBody, AppDialogCancel, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@ai-chat/ui/components/ui/app-dialog";
import {
  SettingsAlert,
} from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type {
  WidgetUninstallReview,
  WidgetUninstallResult,
  WidgetRetirementReview,
  WidgetRetirementResult,
} from "../../../../../../shared/system-dock/widgets/install/lifecycle";
export function WidgetUninstallDialog({
  review,
  mode = "uninstall",
  onClose,
  onChanged,
  onReturnFocus,
}: {
  review: WidgetUninstallReview | WidgetRetirementReview;
  mode?: "uninstall" | "definition";
  onClose(): void;
  onChanged(): void;
  onReturnFocus(): void;
}) {
  const { t } = useAppTranslation(),
    pendingId =
      "pendingOperationId" in review ? review.pendingOperationId : undefined,
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [result, setResult] = useState<
      WidgetUninstallResult | WidgetRetirementResult | null
    >(null),
    [requested, setRequested] = useState(Boolean(pendingId));
  const operation = useRef<string | null>(pendingId ?? null),
    lock = useRef(false),
    definition = mode === "definition",
    copy = definition
      ? "systemDock.widgets.definitionDelete"
      : "systemDock.widgets.uninstall";
  const confirm = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    const bridge = window.systemDockSettings!;
    operation.current ??= crypto.randomUUID();
    setRequested(true);
    try {
      const existing = await bridge.widgetLifecycleControl({
        kind: definition ? "definition-operation" : "uninstall-operation",
        operationId: operation.current,
      });
      const value =
        (existing.kind === "uninstall-result" ||
          existing.kind === "definition-result") &&
        existing.result
          ? await bridge.widgetLifecycleControl({
              kind: definition ? "definition-retry" : "uninstall-retry",
              operationId: operation.current,
            })
          : await bridge.widgetLifecycleControl({
              kind: definition ? "definition-confirm" : "uninstall-confirm",
              operationId: operation.current,
              reviewId: review.reviewId,
            });
      if (
        value.kind === "uninstall-result" ||
        value.kind === "definition-result"
      )
        setResult(value.result);
      onChanged();
    } catch {
      setFailed(true);
      try {
        const value = await bridge.widgetLifecycleControl({
          kind: definition ? "definition-operation" : "uninstall-operation",
          operationId: operation.current,
        });
        if (
          value.kind === "uninstall-result" ||
          value.kind === "definition-result"
        )
          setResult(value.result);
      } catch {
        /* Keep the original request until Main can return its receipt. */
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const removed = result?.state === "removed";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AppDialogContent
        data-widget-uninstall-review={mode}

        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <AppDialogHeader
          title={t(`${copy}.title`, { name: review.name })}
          description={t(`${copy}.hint`)}
        />
        <AppDialogBody className="space-y-4">
        {review.instances.length > 0 && (
          <ul
            className="space-y-2 rounded-md border p-3"
            aria-label={t("systemDock.widgets.install.instances")}
          >
            {review.instances.map((instance) => (
              <li key={instance.id} className="text-sm">
                {instance.name}
              </li>
            ))}
          </ul>
        )}
        {busy && <p role="status">{t(`${copy}.removing`)}</p>}
        {removed && <p role="status">{t(`${copy}.removed`)}</p>}
        {(failed || result?.state === "pending") && (
          <SettingsAlert>
            <span role="alert">{t(`${copy}.pending`)}</span>
          </SettingsAlert>
        )}
        </AppDialogBody>
        <AppDialogFooter>
          {removed ? (
            <Button size="pill" disabled={busy} onClick={onClose}>
              {t("systemDock.widgets.install.done")}
            </Button>
          ) : (
            <AppDialogCancel disabled={busy} onClick={onClose}>
              {t("systemDock.widgets.cancel")}
            </AppDialogCancel>
          )}
          {!removed && (
            <Button
              size="pill"
              variant="destructive"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void confirm()}
            >
              {t(requested ? "common.retry" : `${copy}.confirm`)}
            </Button>
          )}
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
