/**
 * [INPUT]: Uses `../../../../shared/ipc/agent/presence-ipc`, `../../../../shared/system-dock/ipc` for its declared types and implementation.
 * [OUTPUT]: Provides DockTasksPort, taskFace, taskDetail, localizeDockTasks and identity-fenced openDockTask with privacy-safe projections and an empty local fallback.
 * [POS]: system-dock/widgets Tasks adapter; shares Presence activity without starting Agents or adding Usage demand.
 */
import type { TaskActivitySnapshot } from "../../../../shared/ipc/agent/presence-ipc";
import type { DockTaskReference, DockTasksDetail, WidgetFace } from "../../../../shared/system-dock/ipc";

export type DockTasksPort = {
  snapshot(): TaskActivitySnapshot;
  subscribe?(listener: () => void): () => void;
  open(task: DockTaskReference, current?:()=>boolean): Promise<void>;
};
const EMPTY: TaskActivitySnapshot = { version: 1, revision: 0, tasks: [], total: 0, running: 0, waiting: 0, overflow: 0, result: null };
export function taskFace(port?: DockTasksPort): Extract<WidgetFace, { type: "builtin.tasks" }> {
  const activity = port?.snapshot() ?? EMPTY;
  return { type: "builtin.tasks", running: activity.running, waiting: activity.waiting, result: activity.result };
}
export function taskDetail(port: DockTasksPort | undefined, mask: boolean): DockTasksDetail {
  const activity = port?.snapshot() ?? EMPTY;
  return { activity: mask ? { ...activity, total: 0, running: 0, waiting: 0, overflow: 0,
    tasks: activity.tasks.map((task) => ({ ...task, title: null, context: null, startedAt: null, subtaskCount: 0 })) } : activity };
}
export async function openDockTask(port: DockTasksPort | undefined, reference: DockTaskReference, live:()=>boolean=()=>true) {
  const current = () => live() && Boolean(port?.snapshot().tasks.some((task) => task.chatId === reference.chatId && task.incarnationId === reference.incarnationId
    && task.requestId === reference.requestId && task.generation === reference.generation));
  if (!current() || !port) throw new Error("TASK_UNAVAILABLE");
  await port.open(reference,current);
}
