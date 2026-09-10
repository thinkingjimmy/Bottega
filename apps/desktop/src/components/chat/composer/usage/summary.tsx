/**
 * [INPUT]: Depends on the shared general-pool summary projection and localized copy.
 * [OUTPUT]: Renders compact window labels with emphasis only on genuinely low remaining values.
 * [POS]: Secondary Agent picker copy; neither quotas nor unknown values change selection policy.
 */
import { Fragment } from "react";
import type { AgentUsageLimits } from "../../../../../shared/usage-limits/types";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { quotaSummaryParts } from "@/lib/usage-limits/format";
export function QuotaSummaryText({ agent, now, customProvider }: { agent: AgentUsageLimits; now: number; customProvider: boolean }) {
  const { t } = useAppTranslation();
  const parts = quotaSummaryParts(agent, now, t, customProvider);
  return typeof parts === "string" ? parts : parts.map((part, index) => <Fragment key={part.id}>
    {index > 0 && " · "}{part.period}{" "}<span className={part.low ? "text-amber-700 dark:text-amber-400" : undefined}>{part.text}</span>
  </Fragment>);
}
