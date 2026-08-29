/**
 * [INPUT]: Depends on DurableJson, Node fs.watch/timers, resolved Design workspaces, and caller-supplied secure refresh callbacks
 * [OUTPUT]: Provides per-turn DesignWatcher lifecycles, raw drafting signals, suppression tombstones, rejection-safe finish barriers, and an awaitable permanent workspace fence for custody deletion
 * [POS]: Design's filesystem-to-product event bridge; each turn owns its dirty set while destructive custody lifecycle drains and blocks the resolved workspace
 */

import { watch, type FSWatcher } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { DurableJson } from "../persistence/durable-json";

const tombstoneSchema = z
  .object({
    chatId: z.string().min(1).max(128),
    conversationIncarnationId: z.string().min(1).max(128),
    suppressedAt: z.number().int().nonnegative(),
  })
  .strict();
const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    tombstones: z.array(tombstoneSchema),
  })
  .strict();

type WatchKey = Readonly<{
  chatId: string;
  conversationIncarnationId: string;
}>;
type TurnWatchKey = WatchKey & Readonly<{ turnId: string }>;
type WatchArm = TurnWatchKey & Readonly<{
  turnId: string;
  workspace: string;
  refresh(): Promise<Readonly<{ files: readonly string[]; drafting: boolean }>>;
  onDrafting(): void | Promise<void>;
  onChanged(files: readonly string[]): void | Promise<void>;
  onSettled(files: readonly string[]): void | Promise<void>;
  onFinished?(): void | Promise<void>;
}>;
type ActiveWatch = {
  watcher: FSWatcher | null;
  poll: ReturnType<typeof setInterval>;
  arm: WatchArm;
  debounce: ReturnType<typeof setTimeout> | null;
  terminal: ReturnType<typeof setTimeout> | null;
  dirty: Set<string>;
  phase: "active" | "settling" | "finishing";
  refreshing: Promise<void> | null;
  finishing: Promise<void> | null;
  workspaceRoot: string;
};

export class DesignWatcher {
  private readonly suppression: DurableJson<z.infer<typeof fileSchema>>;
  private readonly active = new Map<string, ActiveWatch>();
  private readonly finishBarriers = new Set<Promise<void>>();
  private readonly scopeTails = new Map<string, Promise<void>>();
  private readonly fencedWorkspaces = new Set<string>();

  constructor(
    userData: string,
    private readonly now: () => number = Date.now,
    private readonly debounceMs = 150,
    private readonly terminalGraceMs = 1_500,
    private readonly pollMs = 500
  ) {
    this.suppression = new DurableJson(
      join(userData, "design", "suppression.json"),
      fileSchema,
      () => ({ schemaVersion: 1, revision: 0, tombstones: [] })
    );
  }

  initialize() {
    return this.suppression.initialize();
  }

  isSuppressed(input: WatchKey) {
    return this.suppression.snapshot().tombstones.some(
      (item) => watchScopeKey(item) === watchScopeKey(input)
    );
  }

  suppress(input: WatchKey) {
    return this.suppression.mutate((state) => {
      if (
        state.tombstones.some(
          (item) => watchScopeKey(item) === watchScopeKey(input)
        )
      ) return;
      state.tombstones.push({ ...input, suppressedAt: this.now() });
      state.revision += 1;
    });
  }

  clearSuppression(input: WatchKey) {
    return this.suppression.mutate((state) => {
      const retained = state.tombstones.filter(
        (item) => watchScopeKey(item) !== watchScopeKey(input)
      );
      if (retained.length === state.tombstones.length) return;
      state.tombstones = retained;
      state.revision += 1;
    });
  }

  arm(input: WatchArm) {
    const scope = watchScopeKey(input);
    const previous = this.scopeTails.get(scope) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(() => this.armNow(input));
    const settled = running.then(
      () => undefined,
      () => undefined
    );
    this.scopeTails.set(scope, settled);
    void settled.then(() => {
      if (this.scopeTails.get(scope) === settled) this.scopeTails.delete(scope);
    });
    return running;
  }

  private async armNow(input: WatchArm) {
    const key = turnKey(input);
    const prior = [...this.active.entries()].filter(
      ([candidate, active]) =>
        candidate !== key &&
        watchScopeKey(active.arm) === watchScopeKey(input)
    );
    await Promise.all(prior.map(([candidate]) => this.finish(candidate)));
    if (this.active.has(key)) await this.finish(key);
    const root = await realpath(input.workspace);
    if (this.fencedWorkspaces.has(root)) {
      throw Object.assign(new Error("Design workspace custody 正在或已经删除"), {
        status: 410,
      });
    }
    const directory = join(root, "design");
    // 绝不预建 design/：Design 开启后每个 chat 都会 arm，若在此 mkdir，会在用户
    // 每个仓库里留下空的 design/ 且无清理路径。design/ 只在真正 writeRegistered
    // 时创建。此处 design/ 不存在时回退为“仅轮询”——poll 每 pollMs 扫一次，
    // scanAndRegister 会在目录出现后自然发现它。
    const observed = await realpath(directory).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    });
    if (observed !== null && observed !== directory) {
      throw Object.assign(new Error("Design watcher 拒绝符号链接目录"), { status: 403 });
    }
    const active: ActiveWatch = {
      arm: input,
      debounce: null,
      terminal: null,
      dirty: new Set(),
      phase: "active",
      refreshing: null,
      finishing: null,
      workspaceRoot: root,
      watcher: null,
      poll: setInterval(() => this.schedule(key), this.pollMs),
    };
    active.poll.unref?.();
    this.active.set(key, active);
    if (observed === null) return;
    try {
      active.watcher = watch(
        observed,
        { persistent: false },
        () => this.schedule(key)
      );
      active.watcher.on("error", (cause) => {
        console.warn("[design] fs.watch unavailable; polling remains active", cause);
        active.watcher?.close();
        active.watcher = null;
      });
    } catch (cause) {
      console.warn("[design] fs.watch unavailable; polling remains active", cause);
    }
  }

  settle(input: TurnWatchKey) {
    const key = turnKey(input);
    const active = this.active.get(key);
    if (!active || active.phase !== "active") return;
    active.phase = "settling";
    active.terminal = setTimeout(
      () => void this.finish(key),
      this.terminalGraceMs
    );
  }

  async fenceWorkspace(workspace: string) {
    const root = await realpath(workspace).catch(() => resolve(workspace));
    this.fencedWorkspaces.add(root);
    const matching = [...this.active.entries()].filter(
      ([, active]) => active.workspaceRoot === root
    );
    await Promise.all(
      matching.map(([key, active]) => this.cancelForFence(key, active))
    );
  }

  async closeAndFlush() {
    await Promise.allSettled([...this.scopeTails.values()]);
    await Promise.all([...this.active.keys()].map((key) => this.finish(key)));
    await Promise.allSettled([...this.finishBarriers]);
    await this.suppression.closeAndFlush();
  }

  private schedule(key: string) {
    const active = this.active.get(key);
    if (!active || active.phase === "finishing") return;
    if (active.debounce) clearTimeout(active.debounce);
    active.debounce = setTimeout(
      () => void this.refresh(key).catch(() => undefined),
      this.debounceMs
    );
  }

  private async refresh(key: string) {
    const active = this.active.get(key);
    if (!active || active.phase === "finishing") return;
    active.debounce = null;
    const previous = active.refreshing;
    const running = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.refreshActive(active));
    active.refreshing = running;
    try {
      await running;
    } finally {
      if (active.refreshing === running) active.refreshing = null;
    }
  }

  private async refreshActive(active: ActiveWatch) {
    const { files, drafting } = await active.arm.refresh();
    for (const file of files) active.dirty.add(file);
    if (!this.isSuppressed(active.arm) && drafting) await active.arm.onDrafting();
    if (files.length && !this.isSuppressed(active.arm)) {
      await active.arm.onChanged(files);
    }
  }

  private finish(key: string) {
    const active = this.active.get(key);
    if (!active) return Promise.resolve();
    if (active.finishing) return active.finishing;
    active.phase = "finishing";
    this.stopObserving(active);
    const finishing = (async () => {
      const failures: unknown[] = [];
      if (active.refreshing) {
        await active.refreshing.catch((cause) => failures.push(cause));
      }
      await this.refreshActive(active).catch((cause) => failures.push(cause));
      if (active.dirty.size) {
        try {
          await active.arm.onSettled([...active.dirty].sort());
        } catch (cause) {
          failures.push(cause);
        }
      }
      try {
        await active.arm.onFinished?.();
      } catch (cause) {
        failures.push(cause);
      }
      if (failures.length) {
        throw new AggregateError(
          failures,
          `Design turn ${active.arm.turnId} finished with ${failures.length} watcher failure(s)`
        );
      }
    })()
      .catch((cause) =>
        console.warn("[design] watcher terminal capture failed", cause)
      )
      .finally(() => {
        if (this.active.get(key) === active) this.active.delete(key);
        this.finishBarriers.delete(finishing);
      });
    active.finishing = finishing;
    this.finishBarriers.add(finishing);
    return finishing;
  }

  private stopObserving(active: ActiveWatch) {
    if (active.debounce) clearTimeout(active.debounce);
    if (active.terminal) clearTimeout(active.terminal);
    active.debounce = null;
    active.terminal = null;
    clearInterval(active.poll);
    active.watcher?.close();
    active.watcher = null;
  }

  private cancelForFence(key: string, active: ActiveWatch) {
    if (active.finishing) return active.finishing;
    active.phase = "finishing";
    this.stopObserving(active);
    const finishing = (active.refreshing ?? Promise.resolve())
      .catch((cause) => {
        console.warn("[design] watcher refresh drained with failure", cause);
      })
      .finally(() => {
        void Promise.resolve(active.arm.onFinished?.()).catch((cause) => {
          console.warn("[design] watcher cleanup failed", cause);
        });
        if (this.active.get(key) === active) this.active.delete(key);
        this.finishBarriers.delete(finishing);
      });
    active.finishing = finishing;
    this.finishBarriers.add(finishing);
    return finishing;
  }
}

const watchScopeKey = (input: WatchKey) =>
  `${input.chatId}\0${input.conversationIncarnationId}`;
const turnKey = (input: TurnWatchKey) =>
  `${watchScopeKey(input)}\0${input.turnId}`;
