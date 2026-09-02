/**
 * [INPUT]: Depends on app-state translation-key maps, Apps i18n, repair eligibility, and UI card/button primitives
 * [OUTPUT]: Provides AppFailureCard for retry, cancel, repair, and full-log failure actions
 * [POS]: Apps failure surface consumed by AppDetailView; durable Base imports expose only continue or cancel
 */

import { RefreshCw, Trash2, Wrench } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ai-chat/ui/components/ui/card";
import { repairSite, type AppRecord } from "../../../shared/apps-ipc";
import {
  failureTitleKey,
  isFailedState,
  isPendingBaseImport,
  retryLabelKey,
} from "./app-state";
import { useAppTranslation } from "@/components/providers/i18n-provider";

type AppFailureCardProps = {
  record: AppRecord;
  onRetry: () => void;
  onCancel: () => void;
  onRepair: () => void;
  onShowLog: () => void;
};

export function AppFailureCard({
  record,
  onRetry,
  onCancel,
  onRepair,
  onShowLog,
}: AppFailureCardProps) {
  const { t } = useAppTranslation();
  if (!isFailedState(record.state)) return null;
  const pendingImport = isPendingBaseImport(record);
  return (
    <div className="flex size-full items-center justify-center p-8">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t(failureTitleKey[record.state])}</CardTitle>
          <CardDescription>
            {t("apps.failure.phase", {
              phase:
                record.lastError?.phase ?? t("apps.failure.unknownPhase"),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-destructive text-sm">
            {record.lastError?.message}
          </p>
          <div className="flex gap-2">
            <Button onClick={onRetry}>
              <RefreshCw />
              {pendingImport
                ? t("apps.failure.continueInstall")
                : t(retryLabelKey[record.state])}
            </Button>
            {pendingImport && (
              <Button variant="destructive" onClick={onCancel}>
                <Trash2 />
                {t("apps.failure.cancelInstall")}
              </Button>
            )}
            {!pendingImport && repairSite(record) && (
              <Button variant="secondary" onClick={onRepair}>
                <Wrench />
                {t("apps.failure.repair")}
              </Button>
            )}
            <Button variant="outline" onClick={onShowLog}>
              {t("apps.failure.showLog")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
