/**
 * [INPUT]: Depends on shared ChatStorageFailure, renderer i18n, Chat-storage copy/issue-draft projection, ProductFailureNotice, and ReportIssueButton
 * [OUTPUT]: Provides ChatStorageFailureNotice for storage recovery guidance inside the workspace failure popup with a one-click GitHub report fallback
 * [POS]: Domain wrapper consumed by the Sidebar feedback dialog
 */

import type { ChatStorageFailure } from "../../shared/product-failure";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { chatStorageFailureCopy, chatStorageIssueDraft } from "@/lib/chat-storage-failure";
import { ProductFailureNotice } from "@ai-chat/ui/components/feedback/failure-notice";
import { ReportIssueButton } from "./report-issue-button";

export function ChatStorageFailureNotice({
  failure,
}: {
  failure: ChatStorageFailure;
}) {
  const { t } = useAppTranslation();
  const copy = chatStorageFailureCopy(t, failure);
  const draft = chatStorageIssueDraft(failure, copy);
  return (
    <ProductFailureNotice
      compact
      copy={copy}
      labels={{
        technicalDetails: t("chatStorage.technicalDetails"),
        copyDetails: t("chatStorage.copyDetails"),
        copiedDetails: t("chatStorage.copiedDetails"),
      }}
    >
      {/* 解决办法说完，兜底就在下一行：用户照做仍不行时，不必再找入口。 */}
      <ReportIssueButton body={draft.body} title={draft.title} />
    </ProductFailureNotice>
  );
}
