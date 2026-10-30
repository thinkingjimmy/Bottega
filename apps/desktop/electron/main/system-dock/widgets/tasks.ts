/**
 * [INPUT]: Depends on the main-owned task activity port, Dock task DTOs and lazy workflow labels.
 * [OUTPUT]: Provides DockTasksPort, taskFace, taskDetail, localizeDockTasks and identity-fenced openDockTask with privacy-safe projections and an empty local fallback.
 * [POS]: system-dock/widgets Tasks adapter; shares Presence activity without starting Agents or adding Usage demand.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { workflowMarkerLabels } from "../../workflows/runtime/surface/titles";
import type { TaskActivitySnapshot } from "../../../../shared/ipc/agent/presence-ipc";
import type { DockTaskReference, DockTasksDetail, WidgetFace } from "../../../../shared/system-dock/ipc";

export type DockTasksPort = {
  snapshot(): TaskActivitySnapshot;
  subscribe?(listener: () => void): () => void;
  open(task: DockTaskReference, current?:()=>boolean): Promise<void>;
  labels?(): DockTasksDetail["workflowLabels"];
};
const EMPTY: TaskActivitySnapshot = { version: 1, revision: 0, tasks: [], total: 0, running: 0, waiting: 0, overflow: 0, result: null };
export function taskFace(port?: DockTasksPort): Extract<WidgetFace, { type: "builtin.tasks" }> {
  const activity = port?.snapshot() ?? EMPTY;
  return { type: "builtin.tasks", running: activity.running, waiting: activity.waiting, result: activity.result };
}
export function taskDetail(port: DockTasksPort | undefined, mask: boolean): DockTasksDetail {
  const activity = port?.snapshot() ?? EMPTY;
  return { activity: mask ? { ...activity, total: 0, running: 0, waiting: 0, overflow: 0,
    tasks: activity.tasks.map((task) => ({ ...task, title: null, context: null, startedAt: null, subtaskCount: 0 })) } : activity,
    workflowLabels: port?.labels?.() };
}
export async function openDockTask(port: DockTasksPort | undefined, reference: DockTaskReference, live:()=>boolean=()=>true) {
  const current = () => live() && Boolean(port?.snapshot().tasks.some((task) => task.chatId === reference.chatId && task.incarnationId === reference.incarnationId
    && task.requestId === reference.requestId && task.generation === reference.generation));
  if (!current() || !port) throw new Error("TASK_UNAVAILABLE");
  await port.open(reference,current);
}

/** Workflow copy stays lazy and its late completion cannot revive a closed Dock runtime. */
export function localizeDockTasks(source: DockTasksPort | undefined, locale: () => AppLocale, changed: () => void) {
  let closed = false;
  const labels = new Map<AppLocale, Awaited<ReturnType<typeof workflowMarkerLabels>>>();
  const pending = new Set<AppLocale>();
  const port: DockTasksPort | undefined = source ? { ...source, labels: () => {
    const current = locale();
    if (!closed && !labels.has(current) && !pending.has(current)) {
      pending.add(current);
      void workflowMarkerLabels(current).then((value) => { labels.set(current, value); if (!closed) changed(); })
        .catch(() => {}).finally(() => pending.delete(current));
    }
    return labels.get(current);
  } } : undefined;
  return { port, close() { closed = true; } };
}
