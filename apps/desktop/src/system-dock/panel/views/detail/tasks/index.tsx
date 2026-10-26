/**
 * [INPUT]: Depends on the Dock panel context, isolated task intents, shared Agent marks, task-state icons, lazy task styles and presence copy.
 * [OUTPUT]: Provides TasksDetail with stable task identity, keyboard navigation, phase/role/subtask labels, masked titles, empty/results and validated Chat destinations.
 * [POS]: system-dock/panel/views/detail/tasks; replaces the retired notch task list inside the existing single Dock panel.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { AgentBackendIcon, backendLabel } from "@ai-chat/ui/components/identity/agent";
import type { PresenceTask } from "../../../../../../shared/ipc/agent/presence-ipc";
import { sendIntent } from "../../../../common/bridge";
import { MASK, taskResultLabel } from "../../../../common/format";
import { usePanel } from "../../../context";
import { phaseKey, TaskStateIcon } from "./state";
import "./tasks.css";

const taskKey = (task: PresenceTask) => JSON.stringify([task.chatId, task.incarnationId, task.requestId, task.generation]);
const priority = (task: PresenceTask) => ["approval", "answer", "recovery"].includes(task.phase) ? 0 : 1;
export function TasksDetail() {
  const { snapshot, t, mask, send } = usePanel();
  const [selected, select] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLUListElement>(null);
  const detail = snapshot.tasks;
  const activity = detail?.activity;
  const tasks = [...(activity?.tasks ?? [])].sort((a, b) => priority(a) - priority(b));
  const active = tasks.some((task) => taskKey(task) === selected) ? selected : tasks[0] ? taskKey(tasks[0]) : null;
  const move = (event: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "j", "k", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tasks.findIndex((task) => taskKey(task) === active);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tasks.length - 1
      : Math.max(0, Math.min(tasks.length - 1, index + (["ArrowDown", "j"].includes(event.key) ? 1 : -1)));
    const task = tasks[next];
    if (task) { select(taskKey(task)); root.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }
  };
  const open = async (task: PresenceTask) => {
    setFailed(false);
    const { chatId, incarnationId, requestId, generation } = task;
    const opened = await sendIntent({ kind: "open-task", task: { chatId, incarnationId, requestId, generation } });
    if (!opened) setFailed(true);
  };
  return <div className="tasks-detail">
    {!tasks.length ? <div className="tasks-empty" tabIndex={0}>
      <p role="status">{taskResultLabel(activity?.result ?? null, t)}</p>
      <p className="row-meta">{t("settings.presence.emptyDescription")}</p>
    </div> : <ul className="task-list scroll" ref={root} onKeyDown={move}>
      {tasks.map((task) => {
        const key = taskKey(task);
        const title = mask ? MASK : task.title ?? t("settings.presence.untitled");
        const phase = t(`settings.presence.${phaseKey(task.phase)}`);
        const workflow = task.workflow ? detail?.workflowLabels?.[task.workflow.role] : null;
        return <li key={key}><button type="button" className="task-row" data-task-phase={task.phase}
          tabIndex={active === key ? 0 : -1} data-autofocus={active === key || undefined}
          onFocus={() => select(key)} onClick={() => void open(task)}>
          <AgentBackendIcon backend={task.backend} className="task-agent" />
          <span className="task-content"><span className="task-title">{title}</span>
            {task.context && !mask && <span className="row-meta task-context">{task.context}</span>}
            <span className="row-meta task-phase"><TaskStateIcon phase={task.phase} />{phase}<span>· {backendLabel(task.backend)}</span></span>
            {workflow && <span className="row-meta">{workflow}</span>}
            {!mask && task.subtaskCount > 0 && <span className="row-meta">{t("settings.presence.subtasks", { tasks: task.subtaskCount })}</span>}
          </span><ArrowUpRight className="task-open" aria-hidden="true" />
        </button></li>;
      })}
    </ul>}
    {activity && activity.overflow > 0 && <p className="row-meta">{t("settings.presence.more", { tasks: activity.overflow })}</p>}
    {failed && <p className="note" role="alert">{t("settings.presence.openFailed")}</p>}
    <footer className="panel-footer"><button type="button" className="text-button" onClick={() => send({ kind: "open-main" })}>{t("settings.presence.open")}</button></footer>
  </div>;
}
