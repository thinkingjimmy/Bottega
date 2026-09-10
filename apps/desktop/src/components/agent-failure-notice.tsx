/**
 * [INPUT]: Depends on shared ProductFailure, Agent copy projection, renderer i18n, ProductFailureNotice, and optional caller-provided title icons
 * [OUTPUT]: Provides AgentFailureNotice with tone-selected copy and default icons, optional custom title icons, and agentFailureNoticeLabels for localized diagnostic disclosure
 * [POS]: Agent-specific copy adapter shared by transcript, Setup, Settings, and model-catalog surfaces
 */

import type { ReactNode } from "react";
import type { AgentBackendId } from "../../shared/agent-ipc";
import type { ProductFailure } from "../../shared/product-failure";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { agentFailureCopy } from "@/lib/agent-failure";
import {
  ProductFailureNotice,
  type ProductFailureNoticeLabels,
} from "./product-failure-notice";

export function agentFailureNoticeLabels(
  t: (key: string) => string
): ProductFailureNoticeLabels {
  return {
    technicalDetails: t("agentFailure.technicalDetails"),
    copyDetails: t("agentFailure.copyDetails"),
    copiedDetails: t("agentFailure.copiedDetails"),
  };
}

export function AgentFailureNotice({
  failure,
  backend,
  backendId,
  tone = "danger",
  compact = false,
  icon,
  children,
}: {
  failure: ProductFailure;
  backend: string;
  backendId?: AgentBackendId;
  tone?: "danger" | "warning";
  compact?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useAppTranslation();
  const copy = agentFailureCopy(t, failure, { backend, backendId, tone });
  return (
    <ProductFailureNotice
      compact={compact}
      copy={copy}
      icon={icon}
      labels={agentFailureNoticeLabels(t)}
      tone={tone}
    >
      {children}
    </ProductFailureNotice>
  );
}
