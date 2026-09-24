/**
 * [INPUT]: Depends on the panel context (activity projection, draft, mask, clock), Usage token/cost formatting, Agent names, and the activity Widget schema type.
 * [OUTPUT]: Provides `TokensDetail`: today's tokens and estimated cost with the estimate and unpriced disclosures, completeness issues, the local-time-zone definition of today, a source picker that drafts until Apply/Cancel, update time, Refresh, and Open Usage.
 * [POS]: system-dock/panel/views/detail AI usage renderer (3.4, DCK-18); it reuses the Usage page's cost semantics ("—" when nothing is priced, "$x+" when partly priced) and never infers a balance (INV-12).
 */
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { backendLabel } from "@ai-chat/ui/components/identity/agent";
import type { UsageQueryTarget } from "../../../../../shared/usage-ipc";
import type { AiActivityWidget } from "../../../../../shared/system-dock/layout";
import { costText, formatCompactTokens, formatUsd } from "../../../../lib/usage-client";
import { intlLocale } from "../../../../lib/i18n-locale";
import { MASK, relativeTime } from "../../../common/format";
import { useEscapeLayer, usePanel } from "../../context";
import { StaleDraftNotice } from "./stale-draft";

const STATE_KEYS = { loading: "systemDock.activity.loading", error: "systemDock.activity.error", "no-data": "systemDock.activity.noData" } as const;

export function TokensDetail({ itemId }: { itemId: string }) {
  const { snapshot, t, now, mask, send } = usePanel();
  const activity = snapshot.activity?.itemId === itemId ? snapshot.activity : null;
  const draft = snapshot.draft?.itemId === itemId && snapshot.draft.widget.type === "builtin.ai-activity" ? snapshot.draft.widget : null;
  useEscapeLayer(Boolean(draft), () => send({ kind: "widget-cancel", itemId }));
  if (!activity) return <p className="empty-state" role="status">{t("systemDock.activity.loading")}</p>;
  const face = activity.face;
  const source = draft?.source ?? activity.source;
  const numeric = face.tokens !== null && (face.state === "ok" || face.state === "partial");
  const tokens = !numeric ? "—" : mask ? MASK : formatCompactTokens(face.tokens!);
  const exact = numeric && !mask ? new Intl.NumberFormat(intlLocale()).format(face.tokens!) : undefined;
  const cost = !numeric ? "—" : mask ? MASK : face.costUsd === null ? "—" : costText(face.costUsd, face.tokens!, face.unpricedTokens, formatUsd);
  const timeZone = face.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pickSource = (value: UsageQueryTarget) => {
    const widget: AiActivityWidget = { type: "builtin.ai-activity", configVersion: 1, standard: "compact", source: value, period: "today" };
    // Without a draft, what this detail shows is the applied Widget: that is the base a later remote edit is judged against.
    const base: AiActivityWidget | undefined = draft ? undefined : { ...widget, source: activity.source };
    send({ kind: "widget-draft", itemId, widget, ...(base ? { base } : {}) });
  };
  const notice = face.state === "loading" || face.state === "error" || face.state === "no-data" ? face.state : null;
  return <>
    <div className="scroll">
      {notice && <p className="note" role="status" data-tone={notice === "error" ? "caution" : undefined}>{t(STATE_KEYS[notice])}</p>}
      <dl className="figures">
        <div><dt>{t("systemDock.activity.tokensToday")}</dt><dd title={exact}>{tokens}</dd></div>
        <div><dt>{t("systemDock.activity.estimatedCost")}</dt><dd>{cost}</dd></div>
      </dl>
      <p className="row-meta">{t("systemDock.activity.estimateNote")}</p>
      {numeric && face.unpricedTokens > 0 && <p className="row-meta">{t("systemDock.activity.unpricedNote", { tokens: mask ? MASK : formatCompactTokens(face.unpricedTokens) })}</p>}
      {(face.state === "partial" || activity.issues > 0) && <p className="note" data-tone="caution">{t("systemDock.activity.incomplete")}</p>}
      <p className="row-meta">{t("systemDock.activity.todayDefinition", { timeZone })}</p>
      {activity.scannedFiles > 0 && <p className="row-meta">{t("systemDock.activity.scanned", { count: activity.scannedFiles })}</p>}
      <label className="field-label" htmlFor="dock-activity-source">{t("systemDock.activity.source")}</label>
      <select id="dock-activity-source" className="field" value={source} onChange={(event) => pickSource(event.target.value as UsageQueryTarget)}>
        <option value="all">{t("systemDock.activity.allSources")}</option>
        {activity.sources.map((value) => <option key={value} value={value}>{backendLabel(value)}</option>)}
      </select>
      {draft && draft.source !== activity.source && <p className="row-meta">{t("systemDock.activity.draftNote")}</p>}
      <StaleDraftNotice itemId={itemId} />
      {draft && <div className="button-row">
        <button type="button" className="button" onClick={() => send({ kind: "widget-cancel", itemId })}>{t("systemDock.panel.cancel")}</button>
        <button type="button" className="button primary" onClick={() => send({ kind: "widget-apply", itemId })}>{t("systemDock.panel.apply")}</button>
      </div>}
      {activity.updatedAt !== null && <p className="row-meta">{t("systemDock.panel.updated", { time: relativeTime(activity.updatedAt, now) })}</p>}
    </div>
    <footer className="panel-footer">
      <button type="button" className="text-button" disabled={face.state === "loading"} onClick={() => send({ kind: "refresh-usage", itemId })}>
        <RefreshCw aria-hidden="true" />{t("systemDock.panel.refresh")}</button>
      <button type="button" className="text-button" onClick={() => send({ kind: "open-full-usage", backend: source === "all" ? null : source })}>
        <ArrowUpRight aria-hidden="true" />{t("systemDock.panel.openUsage")}</button>
    </footer>
  </>;
}
