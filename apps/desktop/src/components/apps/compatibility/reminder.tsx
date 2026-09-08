/**
 * [INPUT]: Depends on main-owned compatibility facts, the shared updater, router navigation and existing dialog primitives.
 * [OUTPUT]: Provides an in-place install reminder with upgrade, retry and cancel actions.
 * [POS]: Shared reminder body for preset and URL install dialogs; it never creates a nested modal.
 */

import { useNavigate } from "react-router";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { updateStore } from "@/lib/update-client";
import { ABOUT_SETTINGS_PATH } from "@/lib/settings-navigation";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";

const REASON_KEYS = {
  APP_HOST_UPDATE_REQUIRED: "appHost.APP_HOST_UPDATE_REQUIRED",
  APP_COMPATIBILITY_MISSING: "appHost.APP_COMPATIBILITY_MISSING",
  APP_COMPATIBILITY_INVALID: "appHost.APP_COMPATIBILITY_INVALID",
  APP_COMPATIBILITY_SCHEMA_UNSUPPORTED: "appHost.APP_COMPATIBILITY_SCHEMA_UNSUPPORTED",
  APP_HOST_VERSION_UNAVAILABLE: "appHost.APP_HOST_VERSION_UNAVAILABLE",
} as const;

export function CompatibilityReminder({ failure, onClose, onRetry, appName, busy = false }: {
  failure: AppCompatibilityFailure; onClose(): void; onRetry(): void; appName?: string; busy?: boolean;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const upgrade = failure.code === "APP_HOST_UPDATE_REQUIRED";
  return (
    <div className="flex min-h-0 flex-col gap-5 overflow-y-auto" data-testid="app-compatibility-reminder">
      <DialogHeader>
        <DialogTitle>{t(upgrade ? "appHost.title" : "appHost.invalidTitle")}</DialogTitle>
        <DialogDescription className="whitespace-normal break-words" role="status" aria-live="polite">
          {t(REASON_KEYS[failure.code], { name: appName ?? failure.candidate.appName, minimum: failure.minBottegaVersion ?? "—", current: failure.currentVersion ?? "—" })}
        </DialogDescription>
      </DialogHeader>
      {failure.candidate.hasUsableVersion && <p className="text-sm text-muted-foreground">{t("appHost.oldVersionUsable")}</p>}
      <DialogFooter className="flex-wrap gap-2">
        <Button className="min-h-11" variant="ghost" onClick={onClose}>{t("appHost.cancel")}</Button>
        <Button className="min-h-11" variant="outline" disabled={busy} onClick={onRetry}>{t(busy ? "appHost.checking" : "appHost.recheck")}</Button>
        {upgrade && <Button className="min-h-11" disabled={!failure.requestId} onClick={() => {
          onClose();
          updateStore.ensureLoaded();
          void updateStore.checkForApp(failure.requestId!);
          void navigate(ABOUT_SETTINGS_PATH);
        }}>{t("appHost.upgrade")}</Button>}
      </DialogFooter>
    </div>
  );
}
