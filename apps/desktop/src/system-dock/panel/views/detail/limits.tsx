/**
 * [INPUT]: Depends on the panel context (limits projection, draft, mask, clock), the shared quota presentation policy and pool ordering, Agent identity, and the limits configuration editor.
 * [OUTPUT]: Provides `LimitsDetail`: each selected Agent in selection order with plan, status, every pool/window reading and reset, the window shown on the Dock face, update time, Refresh, Open Usage, and Configure (which resumes a surviving draft).
 * [POS]: system-dock/panel/views/detail AI limits renderer (3.4, DCK-17, DCK-21); readings follow the same quota formatter as Settings › Usage, and the privacy mask covers every value (INV-06, INV-12).
 */
import { useState } from "react";
import { ArrowUpRight, RefreshCw, SlidersHorizontal } from "lucide-react";
import { AgentBackendIcon, backendLabel } from "@ai-chat/ui/components/identity/agent";
import { remainingPercent, sortQuotaPools, quotaWindowExpired } from "@ai-chat/cloud-protocol/remote/quota";
import type { AgentUsageLimits } from "../../../../../shared/usage-limits/types";
import { quotaDate, quotaPercent, quotaPeriod, quotaReset, quotaStatus } from "../../../../lib/usage-limits/format";
import { MASK, relativeTime } from "../../../common/format";
import { usePanel } from "../../context";
import { StaleDraftNotice } from "./stale-draft";
import { LimitsConfig } from "./limits-config";

function AgentLimits({ agent, shown }: { agent: AgentUsageLimits; shown: { poolId: string | null; windowId: string | null } | undefined }) {
  const { t, now, mask } = usePanel();
  const status = quotaStatus(agent, now, t);
  const pools = sortQuotaPools(agent.pools);
  return <li className="card">
    <div className="card-head">
      <AgentBackendIcon backend={agent.backend} className="backend-icon" />
      <span className="card-title">{backendLabel(agent.backend)}</span>
      {agent.planLabel && <span className="row-meta">{agent.planLabel}</span>}
    </div>
    {status && <p className="note" data-tone={agent.availability === "available" ? undefined : "caution"}>{status}</p>}
    {pools.map((pool) => <div key={pool.id} className="pool">
      {pools.length > 1 && <p className="pool-label">{pool.label ?? (pool.isGeneral ? t("settings.usage.limits.general") : pool.id)}</p>}
      <dl className="readings">{pool.windows.map((window) => {
        const value = remainingPercent(window.usedPercent);
        const expired = quotaWindowExpired(window, now);
        const onFace = shown ? shown.poolId === pool.id && (shown.windowId === null || shown.windowId === window.id) : false;
        const reading = value === null ? "—" : t(expired ? "settings.usage.limits.previousValue" : "settings.usage.limits.left", { percent: mask ? MASK : quotaPercent(value) });
        return <div key={window.id} className="reading" data-low={!mask && value !== null && value < 20 && !expired || undefined}>
          <dt>{quotaPeriod(window, t)}{onFace && <span className="chip">{t("systemDock.limits.onFace")}</span>}</dt>
          <dd><strong>{reading}</strong><span>{mask ? MASK : quotaReset(window, agent, now, t)}</span></dd>
        </div>;
      })}</dl>
    </div>)}
    {agent.receivedAt !== null && <p className="row-meta" title={quotaDate(agent.receivedAt)}>{t("systemDock.panel.updated", { time: relativeTime(agent.receivedAt, now) })}</p>}
  </li>;
}

export function LimitsDetail({ itemId }: { itemId: string }) {
  const { snapshot, t, now, send } = usePanel();
  const limits = snapshot.limits?.itemId === itemId ? snapshot.limits : null;
  const hasDraft = snapshot.draft?.itemId === itemId && snapshot.draft.widget.type === "builtin.ai-limits";
  // A draft that survived the panel being destroyed reopens straight into configuration (3.4).
  const [configuring, setConfiguring] = useState(hasDraft);
  if (!limits) return <p className="empty-state" role="status">{t("settings.usage.limits.loading")}</p>;
  if (configuring) return <LimitsConfig itemId={itemId} limits={limits} onDone={() => setConfiguring(false)} />;
  const agents = limits.selected.flatMap((backend) => limits.agents.find((agent) => agent.backend === backend) ?? []);
  return <>
    <div className="scroll">
      <StaleDraftNotice itemId={itemId} />
      {limits.selected.length === 0 ? <div className="empty-state">
        <p>{t("systemDock.limits.emptyDetail")}</p>
        <button type="button" className="button primary" data-autofocus onClick={() => setConfiguring(true)}>{t("systemDock.limits.configure")}</button>
      </div> : <ul className="plain-list cards">{agents.map((agent) => <AgentLimits key={agent.backend} agent={agent} shown={limits.selection[agent.backend]} />)}</ul>}
      {limits.updatedAt !== null && <p className="row-meta">{t("systemDock.panel.updated", { time: relativeTime(limits.updatedAt, now) })}</p>}
      <p className="row-meta">{t("settings.usage.limits.timeZone", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
    </div>
    <footer className="panel-footer">
      <button type="button" className="text-button" disabled={limits.refreshing} aria-busy={limits.refreshing || undefined}
        onClick={() => send({ kind: "refresh-usage", itemId })}><RefreshCw className={limits.refreshing ? "spin" : undefined} aria-hidden="true" />
        {t(limits.refreshing ? "systemDock.panel.refreshing" : "systemDock.panel.refresh")}</button>
      <button type="button" className="text-button" onClick={() => setConfiguring(true)}><SlidersHorizontal aria-hidden="true" />{t("systemDock.limits.configure")}</button>
      <button type="button" className="text-button" onClick={() => send({ kind: "open-full-usage", backend: limits.selected[0] ?? null })}>
        <ArrowUpRight aria-hidden="true" />{t("systemDock.panel.openUsage")}</button>
    </footer>
  </>;
}
