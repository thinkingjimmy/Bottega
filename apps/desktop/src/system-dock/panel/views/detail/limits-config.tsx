/**
 * [INPUT]: Depends on the panel context (draft, Escape layers, intents), the sortable list, Agent identity, the shared quota period formatter and pool ordering, and the limits Widget schema type.
 * [OUTPUT]: Provides `LimitsConfig`: choose which service-confirmed Agents the AI limits Widget shows, order them (drag or Move up/down), pick a pool/window per Agent when several exist, with every change mirrored to main as a draft and explicit Apply / Cancel.
 * [POS]: system-dock/panel/views/detail AI limits editor (3.4, DCK-17, DCK-37); main owns the draft so it survives the panel being destroyed, and Escape is Cancel.
 */
import { useState } from "react";
import { AgentBackendIcon, backendLabel } from "@ai-chat/ui/components/identity/agent";
import { sortQuotaPools } from "@ai-chat/cloud-protocol/remote/quota";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import type { PanelSnapshot } from "../../../../../shared/system-dock/ipc";
import type { AiLimitsWidget } from "../../../../../shared/system-dock/layout";
import { quotaPeriod } from "../../../../lib/usage-limits/format";
import { useEscapeLayer, usePanel } from "../../context";
import { StaleDraftNotice } from "./stale-draft";
import { SortableList } from "../../sortable";

type Limits = NonNullable<PanelSnapshot["limits"]>;
const SEPARATOR = "\u0000";
const applied = (limits: Limits): AiLimitsWidget => ({ type: "builtin.ai-limits", configVersion: 1, standard: "compact",
  selectedBackends: [...limits.selected], selectionByBackend: { ...limits.selection } });

export function LimitsConfig({ itemId, limits, onDone }: { itemId: string; limits: Limits; onDone(): void }) {
  const { snapshot, t, send } = usePanel();
  const draft = snapshot.draft?.itemId === itemId && snapshot.draft.widget.type === "builtin.ai-limits" ? snapshot.draft.widget : null;
  const [working, setWorking] = useState<AiLimitsWidget>(() => draft ?? applied(limits));
  // What the editor opened with: main judges a later remote edit against this, not against its value at the first change.
  const [base] = useState<AiLimitsWidget | undefined>(() => draft ? undefined : applied(limits));
  const draftSignature = draft ? JSON.stringify(draft) : null;
  // A draft main already holds (e.g. from before the panel was destroyed) wins over local state once it changes.
  const [adopted, setAdopted] = useState(draftSignature);
  if (draftSignature !== adopted) { setAdopted(draftSignature); if (draftSignature) setWorking(JSON.parse(draftSignature) as AiLimitsWidget); }
  const change = (next: AiLimitsWidget) => { setWorking(next); send({ kind: "widget-draft", itemId, widget: next, ...(base ? { base } : {}) }); };
  const cancel = () => { send({ kind: "widget-cancel", itemId }); onDone(); };
  useEscapeLayer(true, cancel);
  const toggle = (backend: AgentBackendId, on: boolean) => {
    const selectionByBackend = { ...working.selectionByBackend };
    if (!on) delete selectionByBackend[backend];
    change({ ...working, selectedBackends: on ? [...working.selectedBackends, backend] : working.selectedBackends.filter((value) => value !== backend), selectionByBackend });
  };
  const pick = (backend: AgentBackendId, value: string) => {
    const selectionByBackend = { ...working.selectionByBackend };
    if (!value) delete selectionByBackend[backend];
    else { const [poolId, windowId] = value.split(SEPARATOR); selectionByBackend[backend] = { poolId: poolId || null, windowId: windowId || null }; }
    change({ ...working, selectionByBackend });
  };
  const windowPicker = (backend: AgentBackendId) => {
    const agent = limits.agents.find((value) => value.backend === backend);
    const options = agent ? sortQuotaPools(agent.pools).flatMap((pool) => pool.windows.map((window) => ({
      value: `${pool.id}${SEPARATOR}${window.id}`,
      label: `${pool.label ?? (pool.isGeneral ? t("settings.usage.limits.general") : pool.id)} · ${quotaPeriod(window, t)}`,
    }))) : [];
    // A single window is its own answer; only a real choice gets a control (3.4).
    if (options.length < 2) return null;
    const current = working.selectionByBackend[backend];
    const value = current ? `${current.poolId ?? ""}${SEPARATOR}${current.windowId ?? ""}` : "";
    const stale = Boolean(current) && !options.some((option) => option.value === value);
    return <label className="inline-select">
      <span className="visually-hidden">{t("systemDock.limits.windowFor", { agent: backendLabel(backend) })}</span>
      <select className="field compact" value={stale ? "" : value} onChange={(event) => pick(backend, event.target.value)}
        aria-invalid={stale || undefined}>
        <option value="">{t("systemDock.limits.automatic")}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {stale && <span className="row-meta" data-tone="caution">{t("systemDock.limits.windowGone")}</span>}
    </label>;
  };
  const selected = working.selectedBackends.map((backend) => ({ id: backend, name: backendLabel(backend), backend }));
  const available = limits.configurable.filter((backend) => !working.selectedBackends.includes(backend));
  return <>
    <div className="scroll">
      <p className="note">{t("systemDock.limits.configureHint")}</p>
      {selected.length > 0 && <SortableList rows={selected} label={t("systemDock.limits.selectedLabel")}
        onMove={(backend, index) => {
          const order = working.selectedBackends.filter((value) => value !== backend);
          order.splice(index, 0, backend as AgentBackendId);
          change({ ...working, selectedBackends: order });
        }}
        render={({ backend }, controls) => <div className="row static config-row">
          <label className="check"><input type="checkbox" checked onChange={() => toggle(backend, false)} />
            <AgentBackendIcon backend={backend} className="backend-icon" /><span className="row-title">{backendLabel(backend)}</span></label>
          <span className="row-actions">{controls}</span>
          {windowPicker(backend)}
        </div>} />}
      {available.length > 0 && <ul className="plain-list" aria-label={t("systemDock.limits.availableLabel")}>
        {available.map((backend) => <li key={backend} className="row static config-row">
          <label className="check"><input type="checkbox" checked={false} onChange={() => toggle(backend, true)} />
            <AgentBackendIcon backend={backend} className="backend-icon" /><span className="row-title">{backendLabel(backend)}</span></label>
        </li>)}
      </ul>}
      {limits.configurable.length === 0 && selected.length === 0 && <p className="empty-state">{t("systemDock.limits.noneConfigurable")}</p>}
    </div>
    <StaleDraftNotice itemId={itemId} onDone={onDone} />
    <footer className="panel-footer">
      <button type="button" className="button" onClick={cancel}>{t("systemDock.panel.cancel")}</button>
      <button type="button" className="button primary" onClick={() => { send({ kind: "widget-apply", itemId }); onDone(); }}>{t("systemDock.panel.apply")}</button>
    </footer>
  </>;
}
