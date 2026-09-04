/**
 * [INPUT]: Depends on AppStore source facts, package/Git fingerprinting, RepositoryState baselines, InstallTask execution, and the shared per-App mutation coordinator
 * [OUTPUT]: Provides source inspection, durable source receipts written only when the fingerprint moves, baseline access, a non-blocking startup reconciliation joined at shutdown, and a bounded FD-free polling monitor
 * [POS]: Apps source-observation owner; AppInstaller consumes receipts while this module owns mutable-worktree monitoring policy
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { appSourceStateOf, type AppRecord } from "../../../../shared/apps-ipc";
import { inspectPackage, packageDigest } from "../share/package/package-contract";
import {
  AppMutationCoordinator,
  observeAppSource,
} from "./app-source-coordinator";
import type { AppStore } from "../store/app-store";
import { fingerprintWorkingTree, RepositoryState } from "../install/repository-state";
import type { InstallTask } from "../install/task-queue";

type GitStatus = (
  record: AppRecord,
  task: InstallTask
) => Promise<string>;

export class AppSourceMonitor {
  private readonly repository: RepositoryState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private startupSweep: Promise<unknown> = Promise.resolve();
  private readonly polls = new Map<string, Promise<void>>();

  constructor(
    userData: string,
    private readonly store: AppStore,
    private readonly mutations: AppMutationCoordinator,
    private readonly gitStatus: GitStatus,
    private readonly localTask: () => InstallTask,
    private readonly intervalMs: number
  ) {
    this.repository = new RepositoryState(userData);
  }

  /**
   * 首轮对账不挡窗口：它是 N 个 git 子进程加整包哈希，每条还要串行写一次
   * apps.json。指纹晚几百毫秒到位不影响任何判断，而让用户对着白屏等，影响。
   * 关停时再 join——在飞的对账必须收口，否则 apps.json 会写在退出之后。
   */
  initialize() {
    this.stopped = false;
    this.startupSweep = Promise.allSettled(
      this.store.list().map((record) => this.reconcileAtStartup(record))
    );
    this.timer = setInterval(() => {
      if (this.stopped) return;
      for (const record of this.store.list()) this.poll(record.id);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async shutdown() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.startupSweep;
    await Promise.allSettled(this.polls.values());
  }

  async inspect(record: AppRecord, task: InstallTask) {
    try {
      await access(join(record.dir, ".git"));
    } catch {
      const inspection = await inspectPackage(record.dir);
      return {
        paths: inspection.files.map((file) => file.path),
        fingerprint: await packageDigest(record.dir, inspection.files),
      };
    }
    return fingerprintWorkingTree(record, await this.gitStatus(record, task));
  }

  /**
   * 指纹未变就不落盘：`update` 一次就是一次 fsync + 一条 renderer 广播，
   * 而「没变」本身不是新事实。写盘只发生在指纹真的挪窝的那一刻。
   */
  async persist(appId: string, fingerprint: string) {
    const record = this.store.get(appId);
    if (!record) throw new Error("App 不存在");
    const current = appSourceStateOf(record);
    const observed = observeAppSource(current, fingerprint, Date.now());
    if (observed === current) return current;
    return appSourceStateOf(
      await this.store.update(appId, (value) => ({
        ...value,
        sourceState: observeAppSource(
          appSourceStateOf(value),
          fingerprint,
          Date.now()
        ),
      }))
    );
  }

  readBaseline(appId: string) {
    return this.repository.read(appId);
  }

  removeBaseline(appId: string) {
    return this.repository.remove(appId);
  }

  async writeBaseline(appId: string, fingerprint: string) {
    await this.repository.write(appId, fingerprint);
    return this.persist(appId, fingerprint);
  }

  async reconcileHeld(appId: string) {
    const record = this.store.get(appId);
    if (!record?.manifest || record.state === "deleting") return;
    const observed = await this.inspect(record, this.localTask());
    await this.persist(appId, observed.fingerprint);
  }

  private reconcileAtStartup(record: AppRecord) {
    if (!record.manifest || record.state === "deleting") return Promise.resolve();
    return this.mutations
      .run(record.id, () => this.reconcileHeld(record.id))
      .catch((cause) =>
        console.warn(
          `[apps] startup source fingerprint failed: ${record.id}`,
          cause
        )
      );
  }

  private reconcile(appId: string) {
    if (this.stopped) return Promise.resolve();
    return this.mutations
      .run(appId, () => this.reconcileHeld(appId))
      .catch((cause) =>
        console.warn(`[apps] source monitor reconcile failed: ${appId}`, cause)
      );
  }

  private poll(appId: string) {
    if (this.stopped || this.polls.has(appId)) return;
    const poll = this.reconcile(appId);
    this.polls.set(appId, poll);
    void poll.finally(() => {
      if (this.polls.get(appId) === poll) this.polls.delete(appId);
    });
  }
}
