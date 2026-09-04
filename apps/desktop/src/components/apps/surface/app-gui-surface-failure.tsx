"use client";

/**
 * [INPUT]: Depends on React, the shared ui Button/lucide icon, the i18n provider, and errorMessage/failureCode classification helpers
 * [OUTPUT]: Provides guiFailureKind plus the GuiFailure panel that names permission, cutover, surface, migration, missing-entry and generic failures apart
 * [POS]: components/apps/surface failure leaf; app-gui-surface.tsx renders it whenever no frame may be shown
 */

import { AppWindowIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { errorMessage, failureCode } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ============================================================
 * 一句「App data upgrade failed」不能同时解释四种失败
 *
 * 这块面板从前把「授权过期」「换代超时」「面租约没了」「数据迁移失败」
 * 全印成同一句话——而只有最后一种是真的。用户据此做的每一个判断都错，
 * 因为标题本身就是错的。
 *
 * 分类的两个证据：
 *   1. 稳定机器码——main 的断言写成 `CODE: 人话`，码才是分支依据；
 *   2. 形状——main 答上来了（origin/token/入口俱在）而仍带错误，那就是
 *      数据迁移失败；连答复都没有，就是取绑定这一步没成。
 * 码先于形状：换代超时可能带着一份过期但完整的旧绑定回来。
 * ============================================================ */
const GUI_FAILURE_KIND = {
  APP_STUDIO_GRANT_CONFLICT: "permission",
  BASE_GUI_PARTIAL_DECISION: "permission",
  APP_GUI_DRAIN_TIMEOUT: "cutover",
  GUI_CUTOVER_READY_TIMEOUT: "cutover",
  APP_LIFECYCLE_ADMISSION_CLOSED: "cutover",
  APP_INCARNATION_STALE: "surface",
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
  answered: boolean;
}): keyof typeof GUI_FAILURE_TITLE_KEY {
  const coded = GUI_FAILURE_KIND[
    failureCode(input.error ?? "") as keyof typeof GUI_FAILURE_KIND
  ];
  if (coded) return coded;
  if (input.error) return input.answered ? "migration" : "generic";
  return input.missingEntry ? "missing-entry" : "generic";
}

export function GuiFailure({
  error,
  loading,
  missingEntry,
  answered,
  onRetry,
  onGoToData,
}: {
  error?: string;
  loading: boolean;
  missingEntry: boolean;
  answered: boolean;
  onRetry(): void;
  onGoToData(): void;
}) {
  const { t } = useAppTranslation();
  const kind = guiFailureKind({ error, missingEntry, answered });
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
