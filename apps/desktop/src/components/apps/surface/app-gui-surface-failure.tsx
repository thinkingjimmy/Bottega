"use client";

/**
 * [INPUT]: Depends on React, the shared ui Button/lucide icon, the i18n provider, and errorMessage/failureCode classification helpers
 * [OUTPUT]: Provides guiFailureKind and GuiFailure, classifying permission, cutover, surface and migration failures by explicit machine codes only
 * [POS]: components/apps/surface failure leaf; app-gui-surface.tsx renders it whenever no frame may be shown
 */

import { AppWindowIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { errorMessage, failureCode } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";

// A retained binding can accompany any refresh failure. Only the migration
// owner can identify a data upgrade failure; old tokens are not evidence of one.
const GUI_FAILURE_KIND = {
  APP_STUDIO_GRANT_CONFLICT: "permission",
  BASE_GUI_PARTIAL_DECISION: "permission",
  APP_GUI_DRAIN_TIMEOUT: "cutover",
  GUI_CUTOVER_READY_TIMEOUT: "cutover",
  APP_LIFECYCLE_ADMISSION_CLOSED: "cutover",
  APP_INCARNATION_STALE: "surface",
  APP_SURFACE_LEASE_REVOKED: "surface",
  APP_SURFACE_LEASE_INVALID: "surface",
  APP_DATA_MIGRATION_FAILED: "migration",
} as const;

const GUI_FAILURE_TITLE_KEY = {
  permission: "bases.gui.permissionFailedTitle",
  cutover: "bases.gui.cutoverFailedTitle",
  surface: "bases.gui.surfaceGoneTitle",
  migration: "bases.gui.prepareFailedTitle",
  "missing-entry": "bases.gui.missingEntryTitle",
  generic: "bases.gui.loadFailedTitle",
} as const;

const GUI_FAILURE_HINT_KEY = {
  permission: "bases.gui.permissionFailedHint",
  cutover: "bases.gui.cutoverFailedHint",
  surface: "bases.gui.surfaceGoneHint",
  migration: "bases.gui.prepareFailedHint",
  "missing-entry": "bases.gui.missingEntryHint",
  generic: "bases.gui.loadFailedHint",
} as const;

export function guiFailureKind(input: {
  error?: string;
  missingEntry: boolean;
}): keyof typeof GUI_FAILURE_TITLE_KEY {
  const coded = GUI_FAILURE_KIND[
    failureCode(input.error ?? "") as keyof typeof GUI_FAILURE_KIND
  ];
  if (coded) return coded;
  if (input.error) return "generic";
  return input.missingEntry ? "missing-entry" : "generic";
}

export function GuiFailure({
  error,
  loading,
  missingEntry,
  onRetry,
  onGoToData,
}: {
  error?: string;
  loading: boolean;
  missingEntry: boolean;
  onRetry(): void;
  onGoToData(): void;
}) {
  const { t } = useAppTranslation();
  const kind = guiFailureKind({ error, missingEntry });
  /* 码剥净后可能什么都不剩（只有码没有人话的那种断言）。此时详情行不出现，
     解释全交给上面那句本地化的 hint——把码念给用户听不是解释。 */
  const detail = error ? errorMessage(error) : "";
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <AppWindowIcon className="size-8 text-muted-foreground" />
        <p className="font-medium text-sm">
          {loading ? t("bases.gui.connectingTitle") : t(GUI_FAILURE_TITLE_KEY[kind])}
        </p>
        {!loading && (
          <p className="text-muted-foreground text-xs">
            {t(GUI_FAILURE_HINT_KEY[kind])}
          </p>
        )}
        {!loading && detail && (
          <p className="text-muted-foreground/70 text-xs">{detail}</p>
        )}
        {!loading && (
          <div className="mt-2 flex gap-2">
            <Button className="min-h-11" onClick={onRetry} size="sm" variant="outline">
              {t("bases.gui.retry")}
            </Button>
            <Button className="min-h-11" onClick={onGoToData} size="sm">
              {t("bases.gui.goToData")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
