/**
 * [INPUT]: Depends on lifecycle admission/intents, App/Project/Chat/Base authorities, generation/build/data/grant settlement ports, App shell cleanup, and idempotent finalization
 * [OUTPUT]: Provides replayable cascade/retain-data deletion in data→placement→shell order; placement cleanup is idempotent and reports the Projects it actually touched
 * [POS]: Durable App deletion saga; same-mode concurrent clicks, retries, and crash recovery converge on one monotonic intent, a differing mode is refused instead of silently adopting the flight's disposition, and a recordless replay only finalizes because startup reconciliation owns orphan placements
 */

import type {
  AppRecord,
  RemoveAppInput,
} from "../../../../shared/apps-ipc";
import type {
  AdmissionGate,
  SagaResult,
} from "../../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import { reached, type LifecycleIntent } from "../../lifecycle/intent-types";
import type { ProjectsService } from "../../projects/projects-service";
import type { ConversationCoordinator } from "../../sections/coordinator/conversation-coordinator";
import type { AppStore } from "../store/app-store";

export type AppDeleteDependencies = {
  store: AppStore;
  projects: ProjectsService;
  intents: LifecycleIntentStore;
  gate: AdmissionGate;
  coordinator: ConversationCoordinator;
  runExclusive?<T>(appId: string, operation: () => Promise<T>): Promise<T>;
  listAppChats(appId: string): string[];
  drainAppTurns(appId: string): Promise<void>;
  removeAppChat(chatId: string, appId: string): Promise<void>;
  promoteRetainedBase(projectId: string): Promise<void>;
  convertToBaseCustody(projectId: string, appId: string): Promise<void>;
  removeShell(record: AppRecord): Promise<void>;
  closeAdmission(appId: string): Promise<AppRecord>;
  settleBuilds(appId: string): Promise<void>;
  retireGeneration(appId: string, generationId: string): Promise<void>;
  revokeCapabilities(appId: string): Promise<void>;
  settleData(record: AppRecord, mode: "cascade" | "retain-data"): Promise<void>;
  finalizeRemoval(appId: string): Promise<void>;
  publishRemoval(appId: string): void;
  reportProgress(appId: string): void;
};

/** 与在飞的另一种数据处置互斥;本次删除根本没有开始。 */
export const APP_DELETE_MODE_CONFLICT = "APP_DELETE_MODE_CONFLICT";

/**
 * 删除失败只在「本 App 仍有未终结删除事务」时落到 record。remove() 已先接管
 * 同 App 的残留，所以能从这里冒出来的 residual 通常不是竞争对手，而是刚才真正
 * 执行失败、等待 retry/recovery 的同一条事务。没有 residual 的 409 仍只是与
 * 其他生命周期操作的正常仲裁，不能把尚未开始的删除谎报成 delete-failed。
 * mode 互斥是唯一一种「residual 属于别人」的拒绝：那条在飞事务正常推进中，
 * 它的存在不构成本次失败的证据，故按 typed code 单独排除。
 */
export function shouldMarkDeleteFailed(input: {
  /** undefined = record 已不在,无处可写。 */
  state?: AppRecord["state"];
  hasResidual: boolean;
  /** 拒绝携带的 typed code(若有)。 */
  rejectionCode?: unknown;
}): boolean {
  return input.rejectionCode !== APP_DELETE_MODE_CONFLICT &&
    input.state !== undefined &&
    input.state !== "delete-failed" &&
    input.hasResidual;
}

type Flight = Readonly<{
  /** retry 不带 mode：它领的是残留事务，谁的 mode 由 resume 说了算。 */
  mode: "cascade" | "retain-data" | null;
  promise: Promise<void>;
}>;

export class AppDeleteService {
  private readonly flights = new Map<string, Flight>();

  constructor(private readonly dependencies: AppDeleteDependencies) {}

  /**
   * 该 App 名下未终结的 app-delete intent——「retry 能不能续」与「409 是不是
   * 卡死」问的是同一件事,故只留一个口径。两处各查一遍就是给同一个事实开两个
   * 户口,迟早分叉(record 说已就绪、journal 说删除中,正是这条裂缝的来处)。
   */
  async residual(appId: string): Promise<LifecycleIntent | null> {
    const pending = await this.dependencies.intents.pendingByClaims([
      `app:${appId}`,
    ]);
    return (
      pending.find(
        (intent) =>
          intent.kind === "app-delete" && intent.input.appId === appId
      ) ?? null
    );
  }

  /* 同 mode 的重复删除点击按设计合流到首个事务;retry 却是另一件事——无残留
     时它必须失败,不能让一次正常 remove 领走它的错误。 */
  retry(appId: string) {
    return this.join(`${appId}\u0000retry`, null, async () => {
      const pending = await this.residual(appId);
      if (!pending) {
        throw new Error("没有可恢复的 App 删除事务");
      }
      return this.resume(pending);
    });
  }

  /* 合流只在 mode 相同时成立:一次 retain-data 点击若领走在飞 cascade 的
     承诺,调用方会拿到一张说「已保留数据」的回执,而数据早已被级联删掉。
     两种处置互斥,后到的那一次只能被如实拒绝。 */
  remove(input: RemoveAppInput) {
    const active = this.flights.get(input.appId);
    if (active && active.mode !== input.mode) {
      return Promise.reject(
        statusError(
          409,
          "该 App 正在以另一种数据处置方式删除，请等待其结束后重试",
          APP_DELETE_MODE_CONFLICT
        )
      );
    }
    return this.join(input.appId, input.mode, async () => {
      const pending = await this.residual(input.appId);
      if (pending) return this.resume(pending);
      return this.run(input);
    });
  }

  private join(key: string, mode: Flight["mode"], task: () => Promise<void>) {
    const active = this.flights.get(key);
    if (active) return active.promise;
    const flight: Flight = {
      mode,
      promise: task().finally(() => {
        if (this.flights.get(key) === flight) this.flights.delete(key);
      }),
    };
    this.flights.set(key, flight);
    return flight.promise;
  }

  /** 残留事务的 mode 是既成事实:新点击接管它,而不是另起一条互斥的删除。 */
  private resume(intent: LifecycleIntent) {
    const appId = intent.input.appId;
    const mode = intent.input.mode;
    if (
      typeof appId !== "string" ||
      (mode !== "cascade" && mode !== "retain-data")
    ) {
      throw new Error("App 删除残留事务参数无效");
    }
    return this.run({ appId, mode, requestId: intent.requestId });
  }

  private async run(input: RemoveAppInput) {
    return this.dependencies.runExclusive
      ? this.dependencies.runExclusive(input.appId, () => this.runExclusive(input))
      : this.runExclusive(input);
  }

  private async runExclusive(input: RemoveAppInput) {
    const outcome = await this.dependencies.gate.admitAndRun(
      {
        kind: "app-delete",
        requestId: input.requestId,
        input: { appId: input.appId, mode: input.mode },
        /* project 维在创建时冻结进 claims（R8 闭包）；壳已无 Project 则空串=不占。 */
        allocate: () => ({
          projectId:
            this.dependencies.projects.store.findByAppId(input.appId)?.id ??
            "",
        }),
      },
      (intent) => this.runLocked(intent)
    );
    if (outcome.state === "settled" && outcome.status === "rolled-back") {
      throw statusError(
        409,
        outcome.error?.message ?? "App 删除已被拒绝，请重新发起"
      );
    }
    if (
      outcome.state === "executed" &&
      outcome.result.status === "business-rejected"
    ) {
      throw statusError(409, outcome.result.error.message);
    }
  }

  recover(intent: LifecycleIntent): Promise<SagaResult> {
    const appId = String(intent.input.appId ?? "");
    return this.dependencies.runExclusive
      ? this.dependencies.runExclusive(appId, () => this.runLocked(intent))
      : this.runLocked(intent);
  }

  private runLocked(intent: LifecycleIntent): Promise<SagaResult> {
    return this.dependencies.projects.runExclusive(() => this.execute(intent));
  }

  private async execute(initial: LifecycleIntent): Promise<SagaResult> {
    const input = initial.input as {
      appId: string;
      mode: "cascade" | "retain-data";
    };
    this.dependencies.reportProgress(input.appId);
    let intent = initial;
    let record = this.dependencies.store.get(input.appId);
    if (!record) {
      /* 壳已提交,只剩收尾。残留的 Project placement 归启动期的
         reconcileOrphanAppPlacementsHeld 认领,这里不必再猜它有几条。 */
      await this.dependencies.finalizeRemoval(input.appId);
      this.dependencies.publishRemoval(input.appId);
      return { status: "done", receipt: { appId: input.appId } };
    }
    const baseApp = record.manifest?.kind === "base";
    if (!baseApp && input.mode === "retain-data") {
      return {
        status: "business-rejected",
        error: {
          code: "RETAIN_DATA_REQUIRES_BASE_APP",
          message: "只有 Base App 支持保留 Project 数据",
        },
      };
    }
    /* 普通 App 同样会懒建 Project。删除若只结算 Base App，普通 App 的
       binding 会永久指向已不存在的 App，留下既不能使用也不能退出的孤儿。 */
    const project = this.dependencies.projects.store.findByAppId(input.appId);

    record = await this.dependencies.closeAdmission(input.appId);
    if (!reached("app-delete", intent, "admission-closed")) {
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "admission-closed"
      );
    }

    if (!reached("app-delete", intent, "turns-drained")) {
      await this.dependencies.drainAppTurns(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "turns-drained",
        project ? { projectId: project.id } : undefined
      );
    }

    if (!reached("app-delete", intent, "chats-settled")) {
      for (const chatId of this.dependencies.listAppChats(input.appId)) {
        await this.dependencies.coordinator.runConversationExclusive(
          chatId,
          () => this.dependencies.removeAppChat(chatId, input.appId)
        );
      }
      await this.dependencies.store.update(input.appId, (current) => ({
        ...current,
        editChatSlot: null,
        activeUseChatSlot: null,
        activeUseSwitch: null,
      }));
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "chats-settled"
      );
    }

    /* cascade 不动 Base,写一次 base-settled 纯属空转;只有 retain-data 的
       promote 是真副作用,才值得一个 durable checkpoint。 */
    if (input.mode === "retain-data" && !reached("app-delete", intent, "base-settled")) {
      const projectId = project?.id ?? recoveryProjectId(intent);
      if (!projectId) throw new Error("Retained Base custody Project is missing");
      await this.dependencies.promoteRetainedBase(projectId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "base-settled"
      );
    }

    if (!reached("app-delete", intent, "project-settled")) {
      if (project) {
        if (input.mode === "cascade") {
          await this.dependencies.projects.removeAppProjectHeld(
            project.id,
            input.appId
          );
        } else {
          await this.dependencies.convertToBaseCustody(project.id, input.appId);
        }
      } else if (input.mode === "retain-data") {
        const projectId = recoveryProjectId(intent);
        if (!projectId) throw new Error("Retained Base custody Project is missing");
        await this.dependencies.convertToBaseCustody(projectId, input.appId);
      }
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "project-settled"
      );
    }

    if (!reached("app-delete", intent, "builds-settled")) {
      await this.dependencies.settleBuilds(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "builds-settled"
      );
    }

    if (!reached("app-delete", intent, "generations-retired")) {
      for (const generation of record.generations) {
        await this.dependencies.retireGeneration(
          input.appId,
          generation.generationId
        );
      }
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "generations-retired"
      );
    }

    if (!reached("app-delete", intent, "grants-settled")) {
      await this.dependencies.revokeCapabilities(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "grants-settled"
      );
    }

    if (!reached("app-delete", intent, "data-settled")) {
      await this.dependencies.settleData(record, input.mode);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "data-settled"
      );
    }

    /* 清理本身幂等且自报受影响 Project,无需再冻结一份 id 快照:重放时
       第二次清理返回空集,事件不会重复发。 */
    const { affectedProjectIds } =
      await this.dependencies.projects.clearAppPlacementsHeld(input.appId);
    this.dependencies.projects.publishProjectUpserts(affectedProjectIds);

    const current = this.dependencies.store.get(input.appId);
    if (current) await this.dependencies.removeShell(current);
    await this.dependencies.finalizeRemoval(input.appId);
    this.dependencies.publishRemoval(input.appId);
    return { status: "done", receipt: { appId: input.appId } };
  }
}

function recoveryProjectId(intent: LifecycleIntent) {
  const value = intent.recoveryState.projectId;
  return typeof value === "string" ? value : null;
}

function statusError(status: number, message: string, code?: string) {
  return Object.assign(new Error(message), code ? { status, code } : { status });
}
