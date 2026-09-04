/**
 * [INPUT]: Depends on lifecycle AppPlatformAdmission 4 sets with attachmentAdmissionKey, App/Chat/Project stores and AppReference owner probe
 * [OUTPUT]: The app Provides AppAttachmentFence and AppAttachmentConflictError; grant/clear/default with App Project conversion using the same D17 determination and the same critical area
 * [POS]: The two-way fence for apps/attachments;"Who has the right" to grant-authority, the document only answers "Who and who can't happen simultaneously"
 */

import type { AppGrantRecord, AppGrantTarget } from "../../../../shared/apps-ipc";
import type { ChatStore } from "../../chats/chat-store";
import {
  attachmentAdmissionKey,
  type AppPlatformAdmission,
} from "../../lifecycle/app-platform-admission";
import type { ProjectStore } from "../../projects/store/project-store";
import type { AppStore } from "../store/app-store";
import { resolveAppGrant } from "./grant-resolver";

/** 转换成 App workspace 的两个入口形状：chat 迁入 App Project、Project 绑定 App。 */
export type AppConversionTarget =
  | { kind: "chat"; chatId: string }
  | { kind: "project"; projectId: string };

class AppAttachmentConflictError extends Error {
  /** 业务拒绝，不是内部故障：调用方撤销/等待后重试即可。 */
  readonly status = 409;

  constructor(
    readonly code: string,
    readonly appNames: readonly string[],
    message: string
  ) {
    super(message);
  }
}

type FenceDependencies = {
  apps: AppStore;
  chats: ChatStore;
  projects: ProjectStore;
  admission: AppPlatformAdmission;
  /** 该 chat 名下尚未 released 的 generation-bound reference（D10）。 */
  activeReferences(chatId: string): readonly { appId: string }[];
};

export class AppAttachmentFence {
  constructor(private readonly dependencies: FenceDependencies) {}

  /**
   * 默认授权影响全部 Chat/Project，不能只锁某个 target。全局策略 gate 与所有
   * conversion 相遇，内层仍按 App → usage → Attachment 复核可写 App 身份。
   */
  runDefaultGrant<T>(appId: string, write: () => Promise<T>): Promise<T> {
    return this.dependencies.admission.grantPolicy.run("default-grants", () =>
      this.admit(
        { projectId: null, appId, attachment: `global:${appId}` },
        write
      )
    );
  }

  /**
   * grant 侧：复核与写入必须在同一临界区。此前是「读 project binding → 释放 →
   * 写 grant」，转换若落在这扇窗口里，盘上就留下一条「App Project 的 chat 持有
   * App grant」——当下 `effectiveGrants` 返回空所以看不见，等 Project 解绑 App
   * 后它会静默复活。
   */
  runGrant<T>(
    target: AppGrantTarget,
    appId: string,
    write: () => Promise<T>
  ): Promise<T> {
    return this.admit(
      {
        projectId:
          target.kind === "project"
            ? target.projectId
            : this.dependencies.chats.getProjectId(target.chatId) ?? null,
        appId,
        attachment: attachmentAdmissionKey(target),
      },
      write
    );
  }

  /**
   * clear 不需要 App ready/generation，却必须与 conversion 相遇。若复用 runGrant，
   * 已失败 App 的 tombstone 会无法清理；若直写 Store，clear 又能穿过 conversion。
   * 因而它只锁 Project→Attachment，并把目标合法性留给 authority 在锁内重验。
   */
  runClear<T>(target: AppGrantTarget, write: () => Promise<T>): Promise<T> {
    return this.admit(
      {
        projectId:
          target.kind === "project"
            ? target.projectId
            : this.dependencies.chats.getProjectId(target.chatId) ?? null,
        appId: null,
        attachment: attachmentAdmissionKey(target),
      },
      write
    );
  }

  /** conversion 侧：同一条全序，同一个 attachment key，于是两个方向必然相遇。 */
  runConversion<T>(
    target: AppConversionTarget,
    work: () => Promise<T>
  ): Promise<T> {
    return this.dependencies.admission.grantPolicy.run(
      "default-grants",
      () => this.admit(
        {
          projectId: target.kind === "project" ? target.projectId : null,
          appId: null,
          attachment: attachmentAdmissionKey(target),
        },
        work
      )
    );
  }

  async assertConvertible(target: AppConversionTarget) {
    const conflict = await this.conversionConflict(target);
    if (conflict) throw conflict;
  }

  /**
   * D17：目标一旦是 App workspace，既有授权与在途引用必须先由用户撤销/等待。
   * 返回而不是抛出，是为了让 saga 把它落成 business-rejected——静默清权与
   * 「转换后再补救」都被文档单列为禁止项。
   */
  async conversionConflict(
    target: AppConversionTarget
  ): Promise<AppAttachmentConflictError | null> {
    const names =
      target.kind === "chat"
        ? await this.chatConflicts(target.chatId)
        : await this.projectConflicts(target.projectId);
    if (!names.size) return null;
    const listed = [...names].sort();
    return new AppAttachmentConflictError(
      "APP_ATTACHMENT_PRESENT",
      listed,
      `请先撤销这些 App 的授权并等待进行中的回合结束，然后重试：${listed.join("、")}`
    );
  }

  /* ============================================================
   * D26 全序：global grant policy → Project → App → usage lease → Attachment。
   * 不涉及的节点可跳过，不能换序；反向获取由 gate 自己 fail fast。
   * ============================================================ */
  private admit<T>(
    keys: { projectId: string | null; appId: string | null; attachment: string },
    work: () => Promise<T>
  ): Promise<T> {
    const { project, app, usage, attachment } = this.dependencies.admission;
    const attach = () => attachment.run(keys.attachment, work);
    const withApp = async () => {
      const appId = keys.appId;
      if (!appId) return attach();
      return app.run(appId, async () => {
        const record = this.dependencies.apps.get(appId);
        const active = record?.generationBinding.active;
        if (!record || record.state !== "ready" || !active) {
          throw new Error("App 非 ready 或缺少 active generation");
        }
        /* 短时 planning lease：delete 一关 usage admission，这里当场 fail closed。 */
        const lease = usage.acquire({
          appId,
          generationId: active.generationId,
          lifecycleRevision: record.lifecycleRevision,
        });
        try {
          return await attach();
        } finally {
          usage.release(lease.usageLeaseId);
        }
      });
    };
    return keys.projectId === null
      ? withApp()
      : project.run(keys.projectId, withApp);
  }

  private async chatConflicts(chatId: string) {
    const chat = this.dependencies.chats.getMetadata(chatId);
    const names = new Set<string>();
    const projectId = chat?.projectId ?? null;
    const project = projectId
      ? this.dependencies.projects.get(projectId)?.grants ?? []
      : [];
    this.addEffective(names, chat?.grants ?? [], project, this.installed());
    for (const reference of this.dependencies.activeReferences(chatId)) {
      names.add(this.appName(reference.appId));
    }
    return names;
  }

  private async projectConflicts(projectId: string) {
    const names = new Set<string>();
    const project = this.dependencies.projects.get(projectId)?.grants ?? [];
    /* App 表与成员数无关，扫一次即可；放进 per-chat 循环等于按成员数
       重复 structuredClone 整张表。 */
    const installed = this.installed();
    /* 零成员 Project 仍消费 defaultGrant；Project disabled 则是合法 suppression。 */
    this.addEffective(names, [], project, installed);
    for (const chatId of this.dependencies.chats.listByProject(projectId)) {
      const chat = this.dependencies.chats.getMetadata(chatId);
      this.addEffective(names, chat?.grants ?? [], project, installed);
      for (const reference of this.dependencies.activeReferences(chatId)) {
        names.add(this.appName(reference.appId));
      }
    }
    return names;
  }

  /** 一次成表：id→record 与「带 defaultGrant 的 App」都只算一遍。 */
  private installed() {
    const apps = this.dependencies.apps.list();
    return {
      byId: new Map(apps.map((app) => [app.id, app])),
      defaults: apps.filter((app) => app.defaultGrant).map((app) => app.id),
    };
  }

  private addEffective(
    names: Set<string>,
    directRecords: readonly AppGrantRecord[],
    projectRecords: readonly AppGrantRecord[],
    installed: ReturnType<AppAttachmentFence["installed"]>
  ) {
    const direct = new Map(directRecords.map((record) => [record.appId, record]));
    const project = new Map(projectRecords.map((record) => [record.appId, record]));
    const ids = new Set([
      ...direct.keys(),
      ...project.keys(),
      ...installed.defaults,
    ]);
    for (const appId of ids) {
      if (resolveAppGrant({
        appId,
        chat: direct.get(appId),
        project: project.get(appId),
        global: installed.byId.get(appId)?.defaultGrant,
      }).effective) {
        names.add(this.appName(appId));
      }
    }
  }

  /** 拒绝信息必须让用户认得出是哪个 App，才谈得上「撤销后重试」。 */
  private appName(appId: string) {
    const record = this.dependencies.apps.get(appId);
    return record?.manifest?.name ?? record?.displayName ?? appId;
  }
}
