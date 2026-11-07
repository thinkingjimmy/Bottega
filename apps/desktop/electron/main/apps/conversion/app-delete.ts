/**
 * [INPUT]: Depends on lifecycle admission/intents, App/Project/Chat/Base authorities, generation/build/data/grant settlement ports, App shell cleanup, the main/errors statusError factory, and idempotent finalization
 * [OUTPUT]: Original deletion participants/disposition types and one admission/flight owner for public deletion and main-only retained uninstall.
 * [POS]: App deletion saga admission; same-mode/recovery retains its original intent and Project lock, with ordered execution loaded only for an actual operation.
 */

import type {
  AppRecord,
  RemoveAppInput,
} from "../../../../shared/ipc/apps/apps-ipc";
import { statusError } from "../../ipc/errors";
import type {
  AdmissionGate,
  SagaResult,
} from "../../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
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
  removeShell(record: AppRecord, options?: AppDeleteShellOptions): Promise<void>;
  configurationPresent?(appId: string): boolean;
  hasRetainedRemoval?(appId: string, requestId: string): Promise<boolean>;
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
export type AppDeleteShellOptions = Readonly<{ retainedRequestId: string }>;
export type AppDeletionMode = RemoveAppInput["mode"] | "uninstall";
type DeleteInput = Omit<RemoveAppInput, "mode"> & { mode: AppDeletionMode };

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
  mode: DeleteInput["mode"] | null;
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
    return this.removeWithDisposition(input);
  }

  uninstall(input: { appId: string; requestId: string }) {
    return this.removeWithDisposition({ ...input, mode: "uninstall" });
  }

  private removeWithDisposition(input: DeleteInput) {
    if (this.dependencies.store.portable.isCloudManaged(input.appId)) {
      return Promise.reject(statusError(409, "Use the cloud App controls to remove this installation or delete it across devices.", { code: "CLOUD_APP_DISPOSITION_REQUIRED" }));
    }
    const active = this.flights.get(input.appId);
    if (active && active.mode !== input.mode) {
      return Promise.reject(
        statusError(
          409,
          "该 App 正在以另一种数据处置方式删除，请等待其结束后重试",
          { code: APP_DELETE_MODE_CONFLICT }
        )
      );
    }
    return this.join(input.appId, input.mode, async () => {
      const pending = await this.residual(input.appId);
      if (pending) {
        if ((input.mode === "uninstall" || pending.input.mode === "uninstall") && pending.input.mode !== input.mode)
          throw statusError(409, "The existing App removal has another disposition", { code: APP_DELETE_MODE_CONFLICT });
        return this.resume(pending);
      }
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
      (mode !== "cascade" && mode !== "retain-data" && mode !== "uninstall")
    ) {
      throw new Error("App 删除残留事务参数无效");
    }
    return this.run({ appId, mode, requestId: intent.requestId });
  }

  private async run(input: DeleteInput) {
    return this.dependencies.runExclusive
      ? this.dependencies.runExclusive(input.appId, () => this.runExclusive(input))
      : this.runExclusive(input);
  }

  private async runExclusive(input: DeleteInput) {
    const retained = input.mode === "uninstall" ? await import("./removal/uninstall") : null;
    const outcome = await this.dependencies.gate.admitAndRun(
      {
        kind: "app-delete",
        requestId: input.requestId,
        input: { appId: input.appId, mode: input.mode },
        /* project 维在创建时冻结进 claims（R8 闭包）；壳已无 Project 则空串=不占。 */
        allocate: () => {
          return { projectId: this.dependencies.projects.store.findByAppId(input.appId)?.id ?? "",
            ...(retained ? retained.freezeUninstall(this.dependencies, input.appId) : {}) };
        },
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
    return this.dependencies.projects.runExclusive(async () => {
      const { executeAppDeletion } = await import("./removal/operation");
      return executeAppDeletion(this.dependencies, intent);
    });
  }
}
