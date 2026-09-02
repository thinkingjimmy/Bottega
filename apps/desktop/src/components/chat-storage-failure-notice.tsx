/**
 * [INPUT]: Depends on shared ChatStorageFailure, renderer i18n, Chat-storage copy projection, and ProductFailureNotice
 * [OUTPUT]: Provides ChatStorageFailureNotice for human-first Sidebar storage recovery guidance
 * [POS]: Domain wrapper that keeps storage diagnostics out of primary Sidebar copy
 */

import type { ChatStorageFailure } from "../../shared/product-failure";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { chatStorageFailureCopy } from "@/lib/chat-storage-failure";
import { ProductFailureNotice } from "./product-failure-notice";

export function ChatStorageFailureNotice({
  failure,
}: {
  failure: ChatStorageFailure;
}) {
  const { t } = useAppTranslation();
  return (
    <ProductFailureNotice
      compact
      copy={chatStorageFailureCopy(t, failure)}
      labels={{
        technicalDetails: t("chatStorage.technicalDetails"),
        copyDetails: t("chatStorage.copyDetails"),
        copiedDetails: t("chatStorage.copiedDetails"),
      }}
    />
  );
}
