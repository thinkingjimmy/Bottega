/**
 * [INPUT]: Depends on app-state Document mapping, shared repairSite eligibility is determined by ui card/button
 * [OUTPUT]: Provides AppFailureCard, rendering the failed title/phase/error; Durable Base import can only be continued/cancelled, normal failure can be fixed
 * [POS]: The failure status of the apps component shows the unit, consumed by AppDetailView
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
  failureTitle,
  isFailedState,
  isPendingBaseImport,
  retryLabel,
} from "./app-state";

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
  if (!isFailedState(record.state)) return null;
  const pendingImport = isPendingBaseImport(record);
  return (
    <div className="flex size-full items-center justify-center p-8">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{failureTitle[record.state]}</CardTitle>
          <CardDescription>
            阶段：{record.lastError?.phase ?? "unknown"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-destructive text-sm">
            {record.lastError?.message}
          </p>
          <div className="flex gap-2">
            <Button onClick={onRetry}>
              <RefreshCw />
              {pendingImport ? "继续安装" : retryLabel[record.state]}
            </Button>
            {pendingImport && (
              <Button variant="destructive" onClick={onCancel}>
                <Trash2 />
                取消安装
              </Button>
            )}
            {!pendingImport && repairSite(record) && (
              <Button variant="secondary" onClick={onRepair}>
                <Wrench />
                让维护 Agent 诊断修复
              </Button>
            )}
            <Button variant="outline" onClick={onShowLog}>
              查看完整日志
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
