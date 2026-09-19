/**
 * [INPUT]: Depends on the shared general-pool summary projection, localized copy and UI Skeleton.
 * [OUTPUT]: Renders compact window labels, explicit unavailable states and a fixed-height loading skeleton when no current summary is available.
 * [POS]: The quota row rendered under ../picker.tsx; neither quotas nor unknown values change selection policy.
 */
import { Fragment } from "react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import type { AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
import { createQuotaFormat } from "./format";
import { quotaTranslate } from "./copy";

export function QuotaSummaryText({ agent, now, customProvider = false, locale }: { agent: AgentUsageLimits; now: number; customProvider?: boolean; locale: string }) {
  const t = quotaTranslate(locale), { quotaSummaryParts } = createQuotaFormat(() => locale);
  const parts = quotaSummaryParts(agent, now, t, customProvider);
  if (typeof parts === "string") {
    return !customProvider && agent.fetchState === "refreshing"
      ? <div role="status" aria-label={t("settings.usage.limits.loading")} className="flex h-4 items-center">
        <Skeleton aria-hidden="true" className="h-2.5 w-28 max-w-full rounded-sm bg-foreground/10 motion-reduce:animate-none" />
      </div>
      : parts;
  }
  return parts.map((part, index) => <Fragment key={part.id}>
    {index > 0 && " · "}{part.period}{" "}<span className={part.low ? "text-amber-700 dark:text-amber-400" : undefined}>{part.text}</span>
  </Fragment>);
}
