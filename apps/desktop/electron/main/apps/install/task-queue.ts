/**
 * [INPUT]: Depends on AbortController and the process pid set, not dependent on Electron, store or specific installation logic
 * [OUTPUT]: Provides QueuedWork/InstallTask, the cancel/commit linearization point, SerialTaskQueue, and a drain that keeps failure reporting separate
 * [POS]: The apps/install task-lifecycle kernel; it makes queued/running/settled one awaitable source of truth
 */

export type InstallTask = {
  controller: AbortController;
  pids: Set<number>;
  started: boolean;
  commitStarted: boolean;
  settled: Promise<void>;
};

export type QueuedWork =
  | { kind: "install"; appId: string }
  | {
      kind: "repair";
      appId: string;
      site: "staging" | "copy";
      runId: string;
    };

export function beginTaskCommit(task: InstallTask) {
  if (task.controller.signal.aborted) throw task.controller.signal.reason;
  task.commitStarted = true;
}

export function abortTaskBeforeCommit(task: InstallTask, reason: Error) {
  if (task.commitStarted) throw new Error("正在提交，无法取消");
  task.controller.abort(reason);
}

type TaskEntry = InstallTask & {
  settle: () => void;
};

export class SerialTaskQueue {
  private readonly pending: QueuedWork[] = [];
  private readonly tasks = new Map<string, TaskEntry>();

  enqueue(work: QueuedWork) {
    const task = this.create(work.appId);
    this.pending.push(work);
    return task;
  }

  get(appId: string): InstallTask | undefined {
    return this.tasks.get(appId);
  }

  has(appId: string) {
    return this.tasks.has(appId);
  }

  hasQueued() {
    return this.pending.length > 0;
  }

  entries(): Array<[string, InstallTask]> {
    return [...this.tasks.entries()];
  }

  next(): { work: QueuedWork; appId: string; task: InstallTask } | undefined {
    while (this.pending.length > 0) {
      const work = this.pending.shift()!;
      const appId = work.appId;
      const task = this.tasks.get(appId);
      if (!task || task.started) continue;
      task.started = true;
      return { work, appId, task };
    }
    return undefined;
  }

  takeQueued(appId: string): InstallTask | undefined {
    const task = this.tasks.get(appId);
    if (!task || task.started) return undefined;
    const index = this.pending.findIndex((work) => work.appId === appId);
    if (index < 0) return undefined;
    this.pending.splice(index, 1);
    task.started = true;
    return task;
  }

  complete(appId: string) {
    const task = this.tasks.get(appId);
    if (!task) return;
    this.tasks.delete(appId);
    task.settle();
  }

  private create(appId: string) {
    if (this.tasks.has(appId)) throw new Error("该 App 已有任务在执行");
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const task: TaskEntry = {
      controller: new AbortController(),
      pids: new Set<number>(),
      started: false,
      commitStarted: false,
      settled,
      settle,
    };
    this.tasks.set(appId, task);
    return task;
  }
}

export async function drainSerialTasks(
  queue: SerialTaskQueue,
  run: (appId: string, task: InstallTask, work: QueuedWork) => Promise<void>,
  onError: (appId: string, cause: unknown, work: QueuedWork) => Promise<void>
) {
  for (let next = queue.next(); next; next = queue.next()) {
    try {
      await run(next.appId, next.task, next.work);
    } catch (cause) {
      try {
        await onError(next.appId, cause, next.work);
      } catch {
        // 错误报告也必须被当前任务吸收，队列继续处理后续 App。
      }
    } finally {
      queue.complete(next.appId);
    }
  }
}
