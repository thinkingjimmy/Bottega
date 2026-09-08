/**
 * [INPUT]: Depends on the isolated panel bridge, locale catalogs, shared Agent logos, and React.
 * [OUTPUT]: Provides synchronized compact/expanded views, stable selected task rows, activation-aware neutral idle focus, keyboard navigation, and readonly destinations.
 * [POS]: Auxiliary surface composition; main remains the sole owner of task routing, focus restoration, and panel visibility.
 */
import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CornerDownLeft, Settings } from "lucide-react";
import type { PresenceTask, TaskPanelSnapshot, TaskPanelBridge, TaskPanelIntent } from "../../shared/presence-ipc";
import { loadCatalog } from "../../shared/i18n/catalogs";
import { translate } from "../../shared/i18n/runtime";
import { AgentBackendIcon, backendLabel } from "../lib/agent-backends";
import { TaskSummary } from "./summary";
import { phaseKey, TaskStateIcon, taskKey } from "./task-state";

declare global { interface Window { taskPanel?: TaskPanelBridge; } }
const priority = (task: PresenceTask) => ["approval", "answer", "recovery"].includes(task.phase) ? 0 : task.phase === "finishing" ? 2 : 1;
export function TaskPanel() {
  const [snapshot, setSnapshot] = useState<TaskPanelSnapshot | null>(null);
  const [rows, setRows] = useState<readonly PresenceTask[]>([]);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const expanded = useRef(false);
  const focusOnOpen = useRef(false);
  const revision = useRef(-1);
  const delivery = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let mounted = true;
    const receive = async (value: TaskPanelSnapshot) => {
      if (value.activity.revision < revision.current) return;
      revision.current = value.activity.revision;
      const sequence = ++delivery.current;
      await loadCatalog(value.locale);
      if (!mounted || sequence !== delivery.current || value.activity.revision < revision.current) return;
      document.documentElement.lang = value.locale;
      if (value.expanded) {
        const wasExpanded = expanded.current;
        if (!wasExpanded) focusOnOpen.current = true;
        setRows((previous) => {
          if (!wasExpanded) return [...value.activity.tasks].sort((a, b) => priority(a) - priority(b) || (b.startedAt ?? 0) - (a.startedAt ?? 0) || taskKey(a).localeCompare(taskKey(b)));
          const current = new Map(value.activity.tasks.map((task) => [taskKey(task), task]));
          const retained = previous.filter((task) => current.has(taskKey(task))).map((task) => current.get(taskKey(task))!);
          const seen = new Set(retained.map(taskKey));
          return [...retained, ...value.activity.tasks.filter((task) => !seen.has(taskKey(task)))];
        });
      } else { focusOnOpen.current = false; setRows([]); setError(false); setSelected(null); }
      expanded.current = value.expanded; setSnapshot(value);
    };
    const stop = window.taskPanel?.onChanged((value) => void receive(value));
    void window.taskPanel?.snapshot().then(receive).catch(() => {});
    return () => { mounted = false; stop?.(); };
  }, []);
  useEffect(() => {
    if (!snapshot?.expanded) return;
    const focusPanel = () => {
      const panel = panelRef.current;
      // Native activation can arrive after the snapshot; keep the initial focus pending until then.
      if (!panel || !document.hasFocus()) return;
      const opening = focusOnOpen.current;
      if (!opening && panel.contains(document.activeElement)) return;
      const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button[data-task]")];
      const target = (opening ? buttons[0] : buttons.find((button) => button.dataset.task === selected) ?? buttons[0]) ?? panel;
      focusOnOpen.current = false;
      target.focus({ preventScroll: true });
    };
    window.addEventListener("focus", focusPanel);
    focusPanel();
    return () => window.removeEventListener("focus", focusPanel);
  }, [rows, snapshot?.expanded, selected]);
  const act = (intent: TaskPanelIntent) => void window.taskPanel?.intent(intent).catch(() => setError(true));
  if (!snapshot) return null;
  if (!snapshot.expanded) return <TaskSummary snapshot={snapshot} onIntent={act} />;
  const t = (name: string, options?: Record<string, string | number>) => translate(snapshot.locale, `settings.presence.${name}`, options);
  const activity = snapshot.activity;
  return <section ref={panelRef} className="panel" tabIndex={rows.length ? -1 : 0} aria-label={t("tasks")} onKeyDown={(event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape") { event.preventDefault(); act({ kind: "collapse" }); }
    if (["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) {
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-task]")];
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const down = event.key === "ArrowDown" || event.key === "j";
      const next = buttons[index < 0 ? (down ? 0 : buttons.length - 1) : (index + (down ? 1 : -1) + buttons.length) % buttons.length];
      next?.focus({ preventScroll: true }); next?.scrollIntoView({ block: "nearest" });
    }
  }}>
    <header className="panel-header"><h1>{t("tasks")}</h1>
      <button className="open-main" onClick={() => act({ kind: "open-main" })}><ArrowUpRight aria-hidden="true" />{t("open")}</button>
    </header>
    {error && <p role="alert" className="error">{t("openFailed")}</p>}
    {rows.length === 0 ? <div className="empty" role="status"><strong>{t("empty")}</strong><p>{t("emptyDescription")}</p></div>
      : <div className="rows" role="list">{rows.map((task) => <div role="listitem" key={taskKey(task)}>
        <button data-task={taskKey(task)} data-selected={selected === taskKey(task)} className="task" onFocus={() => setSelected(taskKey(task))}
          onClick={() => act({ kind: "open-task", task: { chatId: task.chatId, incarnationId: task.incarnationId } })}
          aria-label={`${task.title ?? t("untitled")}, ${t(phaseKey(task.phase))}`}>
          <span className="agent" aria-hidden="true"><AgentBackendIcon backend={task.backend} className="backend-icon" /></span>
          <span className="identity"><strong title={task.title ?? undefined}>{task.title ?? t("untitled")}</strong>
            <small>{backendLabel(task.backend)}{task.context ? ` · ${task.context}` : ""}{task.subtaskCount > 0 ? ` · ${t("subtasks", { tasks: task.subtaskCount })}` : ""}</small></span>
          <span className={`phase ${task.phase}`}><TaskStateIcon phase={task.phase} /><span>{t(phaseKey(task.phase))}</span></span>
        </button>
      </div>)}</div>}
    {activity.overflow > 0 && <p className="overflow-note">{t("more", { tasks: activity.overflow })}</p>}
    <footer className="panel-footer"><div className="keyboard-hints">
      <span><kbd>{rows.length ? "↑ ↓" : "⇥"}</kbd>{rows.length > 0 && <kbd>{t("navigationKeys")}</kbd>}{t("selectHint")}</span>
      <span><CornerDownLeft aria-hidden="true" /><kbd>{t("spaceKey")}</kbd>{t("openHint")}</span>
    </div><button className="settings" onClick={() => act({ kind: "open-settings" })} aria-label={t("title")} title={t("title")}><Settings aria-hidden="true" /></button></footer>
  </section>;
}
