/**
 * [INPUT]: Depends on the trusted package review/operation bridge, current Widget progress events and existing accessible Dialog/Settings primitives.
 * [OUTPUT]: Provides WidgetInstallDialog with one immutable confirmation, original-operation retry/cancel, actual byte progress and separate per-instance setup outcomes.
 * [POS]: Host installation UI; package bytes, credentials, compilation and data grants remain in Main.
 */
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@ai-chat/ui/components/ui/dialog";
import {
  SettingsAlert,
  SettingsButton,
} from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type {
  WidgetInstallReview,
  WidgetInstallResult,
  WidgetInstallProgress,
} from "../../../../../../shared/system-dock/widgets/install/types";
export function WidgetInstallDialog({
  review,
  onClose,
  onChanged,
  onConfigure,
  onReturnFocus,
  onInstalled,
}: {
  review: WidgetInstallReview;
  onClose(): void;
  onChanged(): void;
  onConfigure(itemId: string): void;
  onReturnFocus(): void;
  onInstalled?():void;
}) {
  const { t } = useAppTranslation(),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [result, setResult] = useState<WidgetInstallResult | null>(null),
    [progress, setProgress] = useState<WidgetInstallProgress | null>(null),
    [cancelling, setCancelling] = useState(false),
    [hasRequest, setHasRequest] = useState(false);
  const operation = useRef<string | null>(null),
    lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let request = 0;
    const bridge = window.systemDockSettings!;
    const update = () => {
      const version = ++request;
      void bridge.widgetSnapshot().then(
        (snapshot) => {
          if (alive.current && version === request)
            setProgress(
              snapshot.installationProgress?.operationId === operation.current
                ? snapshot.installationProgress
                : null,
            );
        },
        () => {},
      );
    };
    update();
    const stop = bridge.onWidgetsChanged(update);
    return () => {
      alive.current = false;
      stop();
    };
  }, []);
  const finish = (value: WidgetInstallResult | null) => {
    if (!alive.current) return;
    setResult(value);
    onChanged();
  };
  const confirm = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    const bridge = window.systemDockSettings!,
      retry = operation.current !== null;
    operation.current ??= crypto.randomUUID();
    setHasRequest(true);
    try {
      const existing = retry
        ? await bridge.widgetInstallOperation({
            operationId: operation.current,
          })
        : null;
      const value = existing
        ? await bridge.retryWidgetInstall({ operationId: operation.current })
        : await bridge.confirmWidgetInstall({
            operationId: operation.current,
            reviewId: review.reviewId,
          });
      finish(value);
    } catch {
      try {
        finish(
          await bridge.widgetInstallOperation({
            operationId: operation.current,
          }),
        );
      } catch {
        /* Keep the original request while its receipt is unavailable. */
      }
      if (alive.current) setFailed(true);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const cancel = async () => {
    if (!operation.current) {
      onClose();
      return;
    }
    if (cancelling) return;
    setCancelling(true);
    try {
      const value = await window.systemDockSettings!.cancelWidgetInstall({
        operationId: operation.current,
      });
      finish(value);
      if (value.state === "cancelled") onClose();
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setCancelling(false);
    }
  };
  const pending = busy || result?.state === "pending",
    installed = result?.state === "installed",
    finished =
      installed ||
      result?.state === "cancelled" ||
      result?.state === "conflict";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        data-widget-install-review=""
        className="max-h-[85vh] overflow-y-auto"
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogTitle>
          {t("systemDock.widgets.install.title", { name: review.name })}
        </DialogTitle>
        <DialogDescription>
          {t(review.instances.length?"systemDock.widgets.install.hint":"systemDock.widgets.install.emptyHint")}
        </DialogDescription>
        {review.instances.length>0&&<ul
          className="space-y-2 rounded-md border p-3"
          aria-label={t("systemDock.widgets.install.instances")}
        >
          {review.instances.map((instance) => (
            <li key={instance.id} className="text-sm">
              {instance.name}
              {instance.updating
                ? " · " + t("systemDock.widgets.install.oldKept")
                : ""}
            </li>
          ))}
        </ul>}
        {review.dock.data.some(source=>source.kind==="base")&&<p className="text-sm text-muted-foreground">
          {t("systemDock.widgets.install.dataHint")}
        </p>}
        <ul className="list-inside list-disc text-sm">
          {[...new Set(review.dock.data.map((source) => source.kind))].map(
            (kind) => (
              <li key={kind}>{t(`systemDock.widgets.sources.${kind}`)}</li>
            ),
          )}
        </ul>
        {pending && (
          <div role="status" aria-live="polite">
            <p>
              {t(
                `systemDock.widgets.install.${progress?.phase ?? "registering"}`,
              )}
            </p>
            {progress?.completedBytes !== null &&
              progress?.completedBytes !== undefined &&
              progress.totalBytes !== null && (
                <>
                  <progress
                    className="w-full"
                    max={progress.totalBytes || 1}
                    value={progress.completedBytes}
                    aria-label={t("systemDock.widgets.install.downloading")}
                  />
                  <p className="text-xs tabular-nums">
                    {t("systemDock.widgets.install.bytes", {
                      done: progress.completedBytes,
                      total: progress.totalBytes,
                    })}
                  </p>
                </>
              )}
          </div>
        )}
        {(failed ||
          result?.state === "failed" ||
          result?.state === "conflict") && (
          <SettingsAlert>
            <span role="alert">
              {t(
                result?.state === "conflict"
                  ? "systemDock.widgets.conflict"
                  : "systemDock.widgets.install.failed",
              )}
            </span>
          </SettingsAlert>
        )}
        {installed && (
          <div role="status">
            <p>{t("systemDock.widgets.install.installed")}</p>
            {result.needsSetup.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("systemDock.widgets.install.needsSetup")}
              </p>
            )}
            {result.needsSetup.map((id) => (
              <SettingsButton
                key={id}
                variant="outline"
                onClick={() => onConfigure(id)}
              >
                {t("systemDock.widgets.install.configure", {
                  name:
                    review.instances.find((value) => value.id === id)?.name ??
                    review.name,
                })}
              </SettingsButton>
            ))}
          </div>
        )}
        <DialogFooter>
          <SettingsButton
            variant="outline"
            disabled={cancelling}
            onClick={() => {if(installed){onInstalled?.();onClose();}else if(finished)onClose();else void cancel();}}
          >
            {t(
              installed&&onInstalled?"systemDock.widgets.configure":finished
                ? "systemDock.widgets.install.done"
                : "systemDock.widgets.cancel",
            )}
          </SettingsButton>
          {!finished && (
            <SettingsButton
              disabled={pending}
              aria-busy={pending}
              onClick={() => void confirm()}
            >
              {t(
                hasRequest
                  ? "common.retry"
                  : review.repair?"systemDock.widgets.install.repair":review.instances.some((instance) => instance.updating)
                    ? "systemDock.widgets.install.update"
                    : "systemDock.widgets.install.confirm",
              )}
            </SettingsButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
