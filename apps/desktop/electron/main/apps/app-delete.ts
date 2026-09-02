/**
 * [INPUT]: Depends on lifecycle admission/intents, App/Project/Chat/Base authorities, generation/build/data/grant settlement ports, App shell cleanup, and idempotent finalization
 * [OUTPUT]: Provides replayable cascade/retain-data deletion with a durable Project-placement plan before cleanup and data→placement→shell ordering; recordless recovery consumes only a previously frozen plan
 * [POS]: Durable App deletion saga; concurrent clicks, retries, and crash recovery converge on one monotonic intent
 */

import type {
  AppRecord,
  RemoveAppInput,
} from "../../../shared/apps-ipc";
import type {
  AdmissionGate,
  SagaResult,
} from "../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import {
  INTENT_PHASES,
  type LifecycleIntent,
} from "../lifecycle/intent-types";
import type { ProjectsService } from "../projects/projects-service";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { AppStore } from "./app-store";

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

/**
 * 删除失败只在「本 App 仍有未终结删除事务」时落到 record。remove() 已先接管
 * 同 App 的残留，所以能从这里冒出来的 residual 不再是竞争对手，而是刚才真正
 * 执行失败、等待 retry/recovery 的同一条事务。没有 residual 的 409 仍只是与
 * 其他生命周期操作的正常仲裁，不能把尚未开始的删除谎报成 delete-failed。
 */
export function shouldMarkDeleteFailed(input: {
  /** undefined = record 已不在,无处可写。 */
  state?: AppRecord["state"];
  hasResidual: boolean;
}): boolean {
  return input.state !== undefined &&
    input.state !== "delete-failed" &&
    input.hasResidual;
}

export class AppDeleteService {
  private readonly flights = new Map<string, Promise<void>>();

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

  retry(appId: string) {
    return this.join(appId, async () => {
      const pending = await this.residual(appId);
      if (!pending) {
        throw new Error("没有可恢复的 App 删除事务");
      }
      return this.resume(pending);
    });
  }

  remove(input: RemoveAppInput) {
    return this.join(input.appId, async () => {
      const pending = await this.residual(input.appId);
      if (pending) return this.resume(pending);
      return this.run(input);
    });
  }

  private join(appId: string, task: () => Promise<void>) {
    const active = this.flights.get(appId);
    if (active) return active;
    const flight = task().finally(() => {
      if (this.flights.get(appId) === flight) this.flights.delete(appId);
    });
    this.flights.set(appId, flight);
    return flight;
  }

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
      /* record 缺席只证明壳已提交，不能证明此前副作用跑过。只有已经冻结
         placement plan 的事务才可能到过 shell 边界；更早的 intent 必须停住。 */
      assertEstablishedAppAuthority(this.dependencies.store.authorityState());
      const placementProjectIds = recoveryPlacementProjectIds(intent);
      if (!reached(intent, "placements-clearing") || !placementProjectIds) {
        throw missingPlacementPlan();
      }
      await this.dependencies.projects.clearAppPlacementsHeld(input.appId);
      if (!reached(intent, "placements-settled")) {
        intent = await this.dependencies.intents.advance(
          intent.intentId,
          "placements-settled"
        );
      }
      this.dependencies.projects.publishProjectUpserts(placementProjectIds);
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
    if (!reached(intent, "admission-closed")) {
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "admission-closed"
      );
    }

    if (!reached(intent, "turns-drained")) {
      await this.dependencies.drainAppTurns(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "turns-drained",
        project ? { projectId: project.id } : undefined
      );
    }

    if (!reached(intent, "chats-settled")) {
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

    if (!reached(intent, "base-settled")) {
      const projectId = project?.id ?? recoveryProjectId(intent);
      if (input.mode === "retain-data") {
        if (!projectId) throw new Error("Retained Base custody Project is missing");
        await this.dependencies.promoteRetainedBase(projectId);
      }
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "base-settled"
      );
    }

    if (!reached(intent, "project-settled")) {
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

    if (!reached(intent, "builds-settled")) {
      await this.dependencies.settleBuilds(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "builds-settled"
      );
    }

    if (!reached(intent, "generations-retired")) {
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

    if (!reached(intent, "grants-settled")) {
      await this.dependencies.revokeCapabilities(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "grants-settled"
      );
    }

    if (!reached(intent, "data-settled")) {
      await this.dependencies.settleData(record, input.mode);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "data-settled"
      );
    }

    let placementProjectIds = recoveryPlacementProjectIds(intent);
    if (!reached(intent, "placements-clearing")) {
      placementProjectIds = this.dependencies.projects
        .appPlacementProjectIdsHeld(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "placements-clearing",
        { placementProjectIds }
      );
    }
    if (!placementProjectIds) throw missingPlacementPlan();
    if (!reached(intent, "placements-settled")) {
      await this.dependencies.projects.clearAppPlacementsHeld(input.appId);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "placements-settled"
      );
    }
    this.dependencies.projects.publishProjectUpserts(placementProjectIds);

    const current = this.dependencies.store.get(input.appId);
    if (current) await this.dependencies.removeShell(current);
    await this.dependencies.finalizeRemoval(input.appId);
    this.dependencies.publishRemoval(input.appId);
    return { status: "done", receipt: { appId: input.appId } };
  }
}

function reached(intent: LifecycleIntent, phase: string) {
  const phases = INTENT_PHASES["app-delete"] as readonly string[];
  return phases.indexOf(intent.phase) >= phases.indexOf(phase);
}

function recoveryProjectId(intent: LifecycleIntent) {
  const value = intent.recoveryState.projectId;
  return typeof value === "string" ? value : null;
}

function recoveryPlacementProjectIds(intent: LifecycleIntent) {
  const value = intent.recoveryState.placementProjectIds;
  if (!Array.isArray(value) || value.some((projectId) => typeof projectId !== "string")) {
    return null;
  }
  return value as string[];
}

function missingPlacementPlan() {
  return new Error("App 删除 placement decision 缺少 durable Project plan");
}

function assertEstablishedAppAuthority(
  authority: ReturnType<AppStore["authorityState"]>
) {
  if (authority === "degraded-corrupt") {
    throw new Error(
      "AppStore authority 已降级，拒绝以缺失 App record 清理 Project placement"
    );
  }
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
