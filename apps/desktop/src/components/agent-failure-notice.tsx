/**
 * [INPUT]: Depends on shared ProductFailure, Agent copy projection, renderer i18n, and ProductFailureNotice
 * [OUTPUT]: Provides the AgentFailureNotice domain wrapper for human-first Agent failure presentation
 * [POS]: Agent-specific copy adapter shared by transcript, Setup, Settings, and model-catalog surfaces
 */

import type { ReactNode } from "react";
import type { AgentBackendId } from "../../shared/agent-ipc";
import type { ProductFailure } from "../../shared/product-failure";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { agentFailureCopy } from "@/lib/agent-failure";
import { ProductFailureNotice } from "./product-failure-notice";

export function AgentFailureNotice({
  failure,
  backend,
  backendId,
  tone = "danger",
  compact = false,
  children,
}: {
  failure: ProductFailure;
  backend: string;
  backendId?: AgentBackendId;
  tone?: "danger" | "warning";
  compact?: boolean;
  children?: ReactNode;
}) {
  const { t } = useAppTranslation();
  const copy = agentFailureCopy(t, failure, { backend, backendId });
  return (
    <ProductFailureNotice
      compact={compact}
      copy={copy}
      labels={{
        technicalDetails: t("agentFailure.technicalDetails"),
        copyDetails: t("agentFailure.copyDetails"),
        copiedDetails: t("agentFailure.copiedDetails"),
      }}
      tone={tone}
    >
      {children}
    </ProductFailureNotice>
  );
}
