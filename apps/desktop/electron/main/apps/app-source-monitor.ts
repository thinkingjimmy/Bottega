/**
 * [INPUT]: Depends on AppStore source facts, package/Git fingerprinting, RepositoryState baselines, InstallTask execution, and the shared per-App mutation coordinator
 * [OUTPUT]: Provides source inspection, durable source receipts, baseline access, startup reconciliation, and a bounded FD-free polling monitor with quiescent shutdown
 * [POS]: Apps source-observation owner; AppInstaller consumes receipts while this module owns mutable-worktree monitoring policy
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { appSourceStateOf, type AppRecord } from "../../../shared/apps-ipc";
import { inspectPackage, packageDigest } from "./share/package-contract";
import {
  AppMutationCoordinator,
  observeAppSource,
} from "./app-source-coordinator";
import type { AppStore } from "./app-store";
import { fingerprintWorkingTree, RepositoryState } from "./install/repository-state";
import type { InstallTask } from "./install/task-queue";

type GitStatus = (
  record: AppRecord,
  task: InstallTask
) => Promise<string>;

export class AppSourceMonitor {
  private readonly repository: RepositoryState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
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

  async initialize() {
    this.stopped = false;
    await Promise.allSettled(
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

  persist(appId: string, fingerprint: string) {
    return this.store
      .update(appId, (current) => ({
        ...current,
        sourceState: observeAppSource(
          appSourceStateOf(current),
          fingerprint,
          Date.now()
        ),
      }))
      .then((record) => appSourceStateOf(record));
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
