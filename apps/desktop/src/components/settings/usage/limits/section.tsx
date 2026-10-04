/**
 * [INPUT]: Depends on the shared quota store, localized formatting, Settings navigation, SettingsSurface, UsageRegion, UsageInfoTip and ui Tabs.
 * [OUTPUT]: Renders per-Agent headline quotas, complete calendar-aware windows (a window past its reset reads as renewed), resets, recovery states (a Terminal sign-in for a signed-out Agent; for Claude on a custom route, the fix and a reveal of settings.json) and refresh actions for every Provider main reads quota for (a skeleton until its first snapshot names them); a reading stays shown while a read waits, runs or fails, and the status line is a polite live region; opens on a requested Agent's tab.
 * [POS]: Account quota section above local usage history; shares the source-rail grammar with it and never aggregates percentages across pools.
 */
import { useEffect, useRef, useState } from "react";
import { FolderOpen, LogIn, RefreshCw } from "lucide-react";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";
import { AgentBackendIcon, backendLabel } from "@/lib/agent/agent-backends";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useSettingsNavigation } from "@/components/providers/navigation/context";
import { SettingsBadge, SettingsButton, SettingsSurface } from "@/components/settings/settings-layout";
import { UsageInfoTip } from "@/components/settings/usage/usage-info-tip";
import { useUsageLimits, useUsageLimitsDemand } from "@/lib/usage-limits/hooks";
import { usageLimitsStore } from "@/lib/usage-limits/store";
import { quotaDate, quotaHeadline, quotaPercent, quotaPeriod, quotaReset, quotaStatus, quotaSummary } from "@/lib/usage-limits/format";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";
import { currentRemaining, quotaStale, sortQuotaPools } from "../../../../../shared/usage-limits/projection";
import { LIMITS_TIMING, type AgentQuotaPool, type AgentQuotaWindow, type AgentUsageLimits } from "../../../../../shared/usage-limits/types";
import { UsageRegion } from "../usage-region";

/* ============================================================
 * One window is one row, not one card. The bordered card this row replaced
 * sat inside the agent block inside the section card -- three frames around a
 * single number -- and pinned a 96px bar to the far right, leaving the middle
 * of an 848px row empty. Here the bar spans that gap and the value keeps the
 * row's right edge: the flex line aligns every value column without a fixed
 * width, so a longer localized reading widens nothing.
 *
 * Everything hangs off the first line (items-start, the bar nudged to its
 * optical centre) so a row carrying a caution note lines up with one that
 * does not.
 * ============================================================ */
function QuotaWindowRow({ agent, pool, window, now }: { agent: AgentUsageLimits; pool: AgentQuotaPool; window: AgentQuotaWindow; now: number }) {
  const { t } = useAppTranslation();
  const value = currentRemaining(window, now);
  const title = quotaPeriod(window, t);
  const reset = quotaReset(window, now, t);
  const percent = quotaPercent(value);
  const text = value === null ? t("settings.usage.limits.unknown") : t("settings.usage.limits.left", { percent });
  const caution = value !== null && value < 20;
  const scope = pool.isGeneral ? t("settings.usage.limits.general") : pool.label ?? pool.id;
  return <div className="flex items-start gap-4 py-2" data-testid="quota-window" data-window={window.id}>
    <div className="min-w-0 flex-[0_1_15rem]">
      <p className="font-medium text-sm">{title}</p>
      {reset && <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{reset}</p>}
      {caution && <p className="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">{t(value === 0 ? "settings.usage.limits.exhausted" : "settings.usage.limits.low")}</p>}
    </div>
    <div role="progressbar" aria-label={`${backendLabel(agent.backend)} · ${scope} · ${title}`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value ?? undefined} aria-valuetext={reset ? `${text} · ${reset}` : text}
      className="mt-2 h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-muted" data-unknown={value === null}>
      {value !== null && <div className={`h-full rounded-full ${caution ? "bg-amber-600 dark:bg-amber-400" : "bg-foreground"}`} style={{ width: `${value}%` }} />}
    </div>
    <span className={`shrink-0 text-right font-medium text-sm tabular-nums ${caution ? "text-amber-700 dark:text-amber-400" : ""}`}>{value === null ? "—" : text}</span>
  </div>;
}

/* The panel of one tab. The tab already says which Agent this is, so the band
   heading names the content instead of repeating the Agent; "Checked …" sits
   next to the refresh button, which is the thing it qualifies. A lone general
   pool draws no pool heading -- a list of one is not a list -- but a lone named
   pool still gets its name. */
/** The setup actions this section may start; absent where it renders without the setup context. */
export type QuotaSignIn = { run(backend: AgentBackendId): void; busy(backend: AgentBackendId): boolean };

function AgentLimits({ agent, now, customRoute, signIn }: { agent: AgentUsageLimits; now: number; customRoute: boolean; signIn?: QuotaSignIn }) {
  const { t } = useAppTranslation();
  const navigation = useSettingsNavigation();
  const pools = sortQuotaPools(agent.pools);
  const status = quotaStatus(agent, now, t, customRoute);
  const loading = agent.fetchState === "refreshing";
  /* Each verdict gets the one action that fixes it. A custom route is fixed in settings.json, not by signing in (the endpoint
     keeps winning over any login): show that file. Only a signed-out Agent gets the Terminal sign-in, which rechecks on return. */
  const routed = customRoute && agent.availability === "unsupported";
  const canSignIn = signIn && agent.availability === "needs-auth";
  const signingIn = canSignIn && signIn.busy(agent.backend);
  const recovery = !canSignIn && (agent.availability === "needs-auth" || agent.availability === "not-installed");
  /* Mirrors main's manual rule (usage-limits/service.ts start): 30 s since the last attempt, and a server's retry-after. The
     automatic backoff in nextRetryAt never holds a person back, so it must not grey the button out either. */
  const cooldown = agent.lastAttemptAt !== null && now - agent.lastAttemptAt < LIMITS_TIMING.manualMs
    || agent.reasonCode === "rate-limited" && agent.nextRetryAt !== null && now < agent.nextRetryAt;
  const reveal = () => void usageLimitsStore.revealRouteConfig(agent.backend).catch(() => toast.error(t("settings.usage.limits.showRouteConfigFailed")));
  /* While the Agent is busy the read waits for it (their shared sign-in) and the reading stays shown with nothing said over it;
     the greyed refresh is the one control that needs its reason. */
  const waiting = agent.fetchState === "deferred" ? t("settings.usage.limits.summaryDeferred") : undefined;
  const named = (pool: AgentQuotaPool) => pool.isGeneral ? t("settings.usage.limits.general") : pool.label ?? pool.id;
  return <article data-testid={`quota-agent-${agent.backend}`} data-state={agent.availability} aria-busy={loading}>
    <UsageRegion
      title={t("settings.usage.limits.details")}
      /* Refresh qualifies the data, so it sits on the title with the time it was checked; the right corner holds only the fix. */
      titleAction={<>
        <Button type="button" variant="ghost" size="icon-sm" disabled={loading || cooldown || waiting !== undefined} title={waiting}
          aria-label={[t("settings.usage.limits.refresh", { agent: backendLabel(agent.backend) }), waiting].filter(Boolean).join(" · ")} onClick={() => void usageLimitsStore.refresh(agent.backend)}>
          <RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />
        </Button>
        {agent.receivedAt !== null && <span className="truncate text-muted-foreground text-xs tabular-nums" data-stale={quotaStale(agent, now)}>{t("settings.usage.limits.checked", { date: quotaDate(agent.receivedAt) })}</span>}
      </>}
      /* The plan names the account the numbers belong to, so it closes the row as a badge, after any fix. */
      action={(routed || canSignIn || (recovery && navigation) || agent.planLabel) && <div className="flex shrink-0 items-center gap-2">
        {routed && <SettingsButton variant="outline" onClick={reveal}>
          <FolderOpen aria-hidden="true" />{t("settings.usage.limits.showRouteConfig")}
        </SettingsButton>}
        {canSignIn && <SettingsButton variant="outline" disabled={signingIn} onClick={() => signIn.run(agent.backend)}>
          {signingIn ? <Spinner className="size-4" /> : <LogIn aria-hidden="true" />}{t("setup.login")}
        </SettingsButton>}
        {recovery && navigation && <SettingsButton variant="ghost" onClick={navigation.openAgents}>{t("settings.usage.limits.manage")}</SettingsButton>}
        {agent.planLabel && <SettingsBadge>{agent.planLabel}</SettingsBadge>}
      </div>}
    >
      <div className="space-y-3">
        {pools.map((pool) => <section key={pool.id} aria-label={named(pool)} data-pool={pool.id}>
          {(pools.length > 1 || !pool.isGeneral) && <h4 className="mb-1 font-normal text-muted-foreground text-xs">{named(pool)}</h4>}
          {pool.windows.map((window) => <QuotaWindowRow key={window.id} {...{ agent, pool, window, now }} />)}
        </section>)}
        {!pools.length && loading && <Skeleton className="h-11 w-full rounded-md" />}
        {/* Always mounted, so a refresh that ends in a verdict is announced. Amber is for a read that failed with nothing to show;
            a settled verdict (signed out, custom route) is information. */}
        <div role="status" aria-live="polite">
          {status && <p className={`text-xs leading-relaxed ${agent.fetchState === "error" && (agent.availability === "available" || agent.availability === "unavailable") ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{status}</p>}
        </div>
        {!pools.length && !status && <p className="text-xs text-muted-foreground">{t("settings.usage.limits.noWindows")}</p>}
      </div>
    </UsageRegion>
  </article>;
}

/* ============================================================
 * Limits and history are now the same shape: a plain heading, then one surface
 * whose tab strip and panel share a single boundary. Previously this section
 * drew its own card vocabulary (rounded-xl + border on the page ground) beside
 * history's SettingsSurface, so two neighbours on one page disagreed about what
 * "a piece of content" looks like.
 *
 * Every Agent keeps a tab, and each tab carries its own headline percentage:
 * what a tab hides is the panel, not the fact -- comparing Agents is the whole
 * reason to open this page. The tab reads the general pool only, because
 * percentages never aggregate across pools.
 * ============================================================ */
function QuotaTab({ agent, now, customRoute }: { agent: AgentUsageLimits; now: number; customRoute: boolean }) {
  const { t } = useAppTranslation();
  const headline = quotaHeadline(agent, now);
  const pending = !agent.pools.length && agent.fetchState === "refreshing";
  /* The tab carries the short verdict (its accessible name stays a name); the panel below says the whole of it and its fix. */
  const verdict = quotaStatus(agent, now, t, customRoute) !== null ? quotaSummary(agent, now, t) : null;
  return <TabsTrigger value={agent.backend} data-testid={`quota-tab-${agent.backend}`} data-availability={agent.availability}
    className="h-auto flex-none cursor-pointer justify-start gap-2 rounded-none px-4 py-3 text-sm @max-xl:min-w-0 @max-xl:flex-1">
    <AgentBackendIcon backend={agent.backend} className="size-4" />
    <span className="min-w-0 truncate">{backendLabel(agent.backend)}</span>
    {pending ? <Skeleton className="h-4 w-10 shrink-0 rounded-full @max-xl:hidden" /> : <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px] tabular-nums @max-xl:hidden ${headline.low ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-foreground/[0.06]"}`}
    >{headline.text}</span>}
    {verdict ? <UsageInfoTip text={verdict} /> : null}
  </TabsTrigger>;
}

export function UsageLimitsSection({ focusAgent = null, customRoutes, signIn }: { focusAgent?: AgentBackendId | null; customRoutes?: ReadonlySet<string>; signIn?: QuotaSignIn }) {
  const { t } = useAppTranslation();
  const { snapshot, now } = useUsageLimits();
  const region = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<AgentBackendId | null>(null);
  useEffect(() => { region.current?.focus({ preventScroll: true }); }, []);
  useUsageLimitsDemand(true, "settings");
  /* Until the reader picks a tab, land on the Agent whose card sent them here,
     else on the first Agent that actually has windows. The fallback only ever
     moves toward content, and the reader's first click pins it. */
  const fallback = snapshot.agents.find((agent) => agent.pools.length > 0)
    ?? snapshot.agents.find((agent) => agent.availability === "available")
    ?? snapshot.agents[0];
  const selected = chosen ?? focusAgent ?? fallback?.backend;
  return <div ref={region} tabIndex={-1} aria-label={t("settings.usage.limits.title")} className="mb-6 outline-none" data-testid="usage-limits">
    <h2 className="font-heading font-semibold text-sm">{t("settings.usage.limits.title")}</h2>
    <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">{t("settings.usage.limits.note", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
    {/* Main names the Providers with quota; until its first snapshot there is nothing to tab, so the surface holds a skeleton. */}
    {snapshot.revision < 0 ? <SettingsSurface><Skeleton className="h-11 w-full rounded-md" data-testid="usage-limits-pending" /></SettingsSurface>
    : <Tabs value={selected} onValueChange={(next) => setChosen(next as AgentBackendId)} className="gap-0">
      <SettingsSurface>
        <TabsList variant="line" aria-label={t("settings.usage.limits.agent")}
          className="w-full items-stretch justify-start gap-0 rounded-none border-b border-border bg-transparent p-0 group-data-horizontal/tabs:h-auto">
          {snapshot.agents.map((agent) => <QuotaTab key={agent.backend} agent={agent} now={now} customRoute={customRoutes?.has(agent.backend) ?? false} />)}
        </TabsList>
        {snapshot.agents.map((agent) => <TabsContent key={agent.backend} value={agent.backend}>
          <AgentLimits agent={agent} now={now} customRoute={customRoutes?.has(agent.backend) ?? false} signIn={signIn} />
        </TabsContent>)}
      </SettingsSurface>
    </Tabs>}
  </div>;
}
