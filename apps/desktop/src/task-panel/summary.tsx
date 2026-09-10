/**
 * [INPUT]: Depends on the shared panel snapshot, locale runtime, Agent logos, and static status symbols.
 * [OUTPUT]: Provides persistent menu-bar access with a native menu button and a separate task-list toggle.
 * [POS]: Nonactivating compact renderer for the two native notch wings.
 */
import React from "react";
import { ChevronDown, ChevronUp, List, MessageCircleQuestion, Zap } from "lucide-react";
import type { TaskPanelIntent, TaskPanelSnapshot } from "../../shared/presence-ipc";
import { translate } from "../../shared/i18n/runtime";
import { AgentBackendIcon } from "../lib/agent-backends";
import { TaskStateIcon, taskKey } from "./task-state";

export function TaskSummary({ snapshot, onIntent }: { snapshot: TaskPanelSnapshot; onIntent(intent: TaskPanelIntent): void }) {
  const { activity, segment, panelOpen } = snapshot;
  const t = (key: string, values?: Record<string, string | number>) => translate(snapshot.locale, `settings.presence.${key}`, values);
  const result = activity.result;
  const resultLabel = result ? t(result === "failed" ? "failureResult" : result) : null;
  const summary = `${t("tasks")}: ${resultLabel ?? `${t("running", { tasks: activity.running })}, ${t("waiting", { tasks: activity.waiting })}`}`;
  const Chevron = panelOpen ? ChevronUp : ChevronDown;
  const count = (value: number) => value > 99 ? "99+" : value;
  return <div className={`summary summary-${segment}`}>
    {segment !== "right" && <button className="summary-menu-button" aria-label={t("menu")} title={t("menu")} aria-haspopup="menu"
      onClick={() => onIntent({ kind: "menu" })}><List className="summary-menu" aria-hidden="true" /></button>}
    <button className="summary-toggle" aria-label={summary} aria-expanded={panelOpen} title={summary}
      onClick={() => onIntent({ kind: panelOpen ? "collapse" : "expand" })}>
    {segment !== "right" && <span className="counts" aria-hidden="true">
      {resultLabel ? <span className={`result ${result}`}><TaskStateIcon phase={result === "ended" ? "cancelled" : result!} /><span>{resultLabel}</span></span>
        : <><span className={`count running ${activity.running ? "nonzero" : ""}`}><Zap />{count(activity.running)}</span>
          <span className={`count waiting ${activity.waiting ? "nonzero" : ""}`}><MessageCircleQuestion />{count(activity.waiting)}</span></>}
    </span>}
    {segment !== "left" && <span className="summary-end" aria-hidden="true">
      <span className="agents">{activity.tasks.slice(0, 3).map((task) => <span className={`avatar ${task.phase}`} key={taskKey(task)}>
        <AgentBackendIcon backend={task.backend} className="backend-icon" /></span>)}
        {activity.total > 3 && <span className="overflow-count">+{count(activity.total - 3)}</span>}
      </span><Chevron className="summary-chevron" />
    </span>}
    </button>
  </div>;
}
