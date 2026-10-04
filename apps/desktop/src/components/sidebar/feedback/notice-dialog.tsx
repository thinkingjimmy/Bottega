/**
 * [INPUT]: Depends on background failure snapshots, i18n, storage recovery notices, and the shared confirmation dialog.
 * [OUTPUT]: Provides one dismissible workspace failure popup with existing diagnostics, issue reporting, and Base list and cloud retry.
 * [POS]: On-demand presentation leaf loaded by sidebar-notices only while failures exist.
 */
import { useState, type ReactNode } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { chatCopy } from "@ai-chat/chat-ui/copy";
import type { ChatStorageFailure } from "../../../../shared/product/product-failure";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { ChatStorageFailureNotice } from "@/components/chat-storage-failure-notice";
import { ReportIssueButton } from "@/components/report-issue-button";

export function SidebarNoticeDialog({ projectWarnings, storageFailures, chatWarning, basesFailure, cloudError, retryCloud, retryBases }: {
  projectWarnings: string[];
  storageFailures: ChatStorageFailure[];
  chatWarning: string;
  basesFailure: string;
  cloudError: boolean;
  retryCloud(): void;
  retryBases(): void;
}) {
  const { t, i18n } = useAppTranslation();
  const [open, setOpen] = useState(true);
  const notices: Array<{ key: string; title: string; content: ReactNode }> = [];
  for (const warning of projectWarnings) {
    notices.push({ key: `project:${warning}`, title: t("common.projects"), content: <p role="alert">{warning}</p> });
  }
  for (const failure of storageFailures) {
    notices.push({ key: `storage:${JSON.stringify(failure)}`, title: t("common.chats"),
      content: <ChatStorageFailureNotice failure={failure} /> });
  }
  if (chatWarning) {
    notices.push({ key: `chat:${chatWarning}`, title: t("common.chats"), content: <>
      <p role="alert">{chatWarning}</p>
      <p>{t("chatStorage.warningResolution")}</p>
      <ReportIssueButton body={chatWarning} title={chatWarning.split("\n")[0] ?? chatWarning} />
    </> });
  }
  if (basesFailure) {
    notices.push({ key: `bases:${basesFailure}`, title: t("common.bases"), content: <>
      <p role="alert">{basesFailure}</p>
      <Button variant="outline" onClick={retryBases}>{t("common.retry")}</Button>
    </> });
  }
  if (cloudError) {
    notices.push({ key: "cloud:unavailable", title: t("common.chats"), content: <>
      <p role="alert">{chatCopy(i18n.language).unavailable}</p>
      <Button variant="outline" onClick={retryCloud}>{t("common.retry")}</Button>
    </> });
  }
  const title = [...new Set(notices.map(notice => notice.title))].join(" · ");
  return <ConfirmationDialog
    open={open}
    title={title}
    description={<div className="space-y-4 break-words text-left">
      {notices.map(notice => <div key={notice.key} className="space-y-2">{notice.content}</div>)}
    </div>}
    confirmLabel={t("common.close")}
    initialFocus="confirm"
    showCancel={false}
    onOpenChange={setOpen}
    onConfirm={() => setOpen(false)}
  />;
}
