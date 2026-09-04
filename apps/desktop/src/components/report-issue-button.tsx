/**
 * [INPUT]: Depends on React, lucide external-link icon, UI Button, renderer i18n, the app-info store, external-link IPC, and reportIssueUrl
 * [OUTPUT]: Provides ReportIssueButton, the one-click "report on GitHub" fallback that opens a prefilled issue carrying the caller's title/body plus app version facts
 * [POS]: Shared last-resort action for failure notices and plain Sidebar warnings; it owns the destination, never the failure semantics
 */

import { useEffect, useSyncExternalStore } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { openExternal } from "@/lib/agent-client";
import { reportIssueUrl } from "@/lib/report-issue";
import { appInfoStore } from "@/lib/update-client";

/* 兜底永远在场：任何一条用户改不了的失败，都能一键带着技术详情去 GitHub。
   版本与平台由 appInfoStore 提供；它没就绪就发不带版本的 issue，绝不阻塞按钮。 */
export function ReportIssueButton({ title, body }: { title: string; body: string }) {
  const { t } = useAppTranslation();
  const appInfo = useSyncExternalStore(appInfoStore.subscribe, appInfoStore.getSnapshot);
  useEffect(() => {
    appInfoStore.ensureLoaded();
  }, []);
  return (
    <Button
      className="touch-manipulation"
      onClick={() => void openExternal(reportIssueUrl({ title, body, appInfo }))}
      size="sm"
      type="button"
      variant="outline"
    >
      {t("chatStorage.reportIssue")}
      <ExternalLinkIcon aria-hidden="true" data-icon="inline-end" />
    </Button>
  );
}
