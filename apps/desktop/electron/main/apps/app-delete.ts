/**
 * [INPUT]: Depends on lifecycle admission/intents, App/Project/Chat stores, generation/build/data/grant settlement ports, conversation exclusion, and App shell cleanup
 * [OUTPUT]: Provides AppDeleteService remove/retry/recover/residual; every App kind settles its bound Project, while retain-data remains Base-only
 * [POS]: Durable App deletion saga; retries and recovery resume the original intent instead of inventing a second transaction
 */

import type {
  AppRecord,
  RemoveAppInput,
} from "../../../shared/apps-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
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
  listProjectChats(projectId: string): string[];
  getChat(chatId: string): Promise<ChatRecord | null>;
  drainProjectTurns(projectId: string): Promise<void>;
  rotateSession(chat: ChatRecord): Promise<void>;
  removeShell(record: AppRecord): Promise<void>;
  closeAdmission(appId: string): Promise<AppRecord>;
  settleBuilds(appId: string): Promise<void>;
  retireGeneration(appId: string, generationId: string): Promise<void>;
  revokeCapabilities(appId: string): Promise<void>;
  settleData(record: AppRecord, mode: "cascade" | "retain-data"): Promise<void>;
};

/**
 * 删除失败该不该落到 record 上——纯判据,与 IO 分开才测得动。
 *
 * 从前只有一条 `status !== 409`,把 409 当成一种情形。它其实是两种:
 * ① 本方刚被仲裁掉——删除确实没开始,记录未被触碰,标 delete-failed 是谎报;
 * ② 撞上残留——上一次删除中断后卡在 journal 里,而 reconcile 只在开机跑一次,
 *    它永不自愈。此时每次点删除都铸新 requestId(必然更年轻)去输给残留,唯一
 *    能续跑的是复用残留 requestId 的 retry(),而那扇门锁在 delete-failed 后面。
 *    不标,出口与病灶就永远挂在两棵树上——界面说「已就绪」,点删除必 409。
 *
 * record 已在 deleting 的不碰:那说明有 saga 真推进过(closeAdmission 是它第一
 * 件事),状态已如实。若那条 saga 也死了,开机恢复失败会经 markDeleteStalled
 * 落成 delete-failed——中断态的显形交给恢复侧,在线侧不猜活性、不冒撒谎的险。
 */
export function shouldMarkDeleteFailed(input: {
  status?: number;
  /** undefined = record 已不在,无处可写。 */
  state?: AppRecord["state"];
  hasResidual: boolean;
}): boolean {
  if (input.state === undefined) return false;
  if (input.status !== 409) return true;
  if (input.state === "deleting" || input.state === "delete-failed") {
    return false;
  }
  return input.hasResidual;
}

export class AppDeleteService {
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

  async retry(appId: string) {
    const pending = await this.residual(appId);
    const mode = pending?.input.mode;
    if (
      !pending ||
      (mode !== "cascade" && mode !== "retain-data")
    ) {
      throw new Error("没有可恢复的 App 删除事务");
    }
    return this.remove({ appId, mode, requestId: pending.requestId });
  }

  async remove(input: RemoveAppInput) {
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
    return this.runLocked(intent);
  }

  private runLocked(intent: LifecycleIntent): Promise<SagaResult> {
    return this.dependencies.projects.runExclusive(() => this.execute(intent));
  }

  private async execute(initial: LifecycleIntent): Promise<SagaResult> {
    const input = initial.input as {
      appId: string;
      mode: "cascade" | "retain-data";
    };
    let intent = initial;
    let record = this.dependencies.store.get(input.appId);
    if (!record) {
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
      if (project) await this.dependencies.drainProjectTurns(project.id);
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "turns-drained",
        project ? { projectId: project.id } : undefined
      );
    }

    if (!reached(intent, "chats-settled")) {
      if (project && input.mode === "retain-data") {
        for (const chatId of this.dependencies.listProjectChats(project.id)) {
          await this.dependencies.coordinator.runConversationExclusive(
            chatId,
            async () => {
              const chat = await this.dependencies.getChat(chatId);
              if (chat) await this.dependencies.rotateSession(chat);
            }
          );
        }
      }
      await this.dependencies.store.update(input.appId, (current) => ({
        ...current,
        editChatSlot: null,
        activeUseChatSlot: null,
      }));
      intent = await this.dependencies.intents.advance(
        intent.intentId,
        "chats-settled"
      );
    }

    if (!reached(intent, "base-settled")) {
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
        } else if (project.workspaceBinding.kind === "app") {
          await this.dependencies.projects.detachAppProjectHeld(
            project.id,
            input.appId
          );
        }
      }
      if (input.mode === "retain-data") {
        // binding 已翻转为 none，成员 chat 的 App 角色必须同批清零——残留会违反
        // 「普通 Project 聊天不携带 App 角色」的写侧不变量（契约的 detach 残留对账项）。
        // projectId 走 recoveryState：崩溃重入时 findByAppId 已查不到这个 Project。
        const projectId = project?.id ?? recoveryProjectId(intent);
        const members = projectId
          ? this.dependencies.listProjectChats(projectId)
          : [];
        for (const chatId of members) {
          const chat = await this.dependencies.getChat(chatId);
          if (chat?.projectId === projectId && chat.appRole !== null) {
            await this.dependencies.projects.moveChatProjectHeld(
              chatId,
              projectId,
              projectId,
              null
            );
          }
        }
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

    const current = this.dependencies.store.get(input.appId);
    if (current) await this.dependencies.removeShell(current);
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

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
