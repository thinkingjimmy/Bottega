/**
 * [INPUT]: Depends on Appstore, ChatStore, ProjectStore, AppAttachmentFence, grant-resolver and shared Apps grant DTO
 * [OUTPUT]: Provides AppGrantAuthority to implement the same grant fence|disabled|clear, default global authorization, three-source projection, unified effective authorization and deletion clearance
 * [POS]: The authorization of apps/attachments is the sole authority; The only intention is to endure, not start runtime, not issue surface/reference lease
 */

import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppDisabledGrant,
  type AppDomainIdentity,
  type EffectiveAppGrant,
  type AppGrantRecord,
  type AppGrantSnapshot,
  type AppGrantSource,
  type AppGrantSourcesSnapshot,
  type AppGrantTarget,
  type AvailableAppsInput,
  type AvailableAttachedApp,
  type SetAppGrantInput,
  type SetAppGrantStateInput,
  type SetDefaultAppGrantInput,
} from "../../../../shared/apps-ipc";
import type { ChatStore } from "../../chats/chat-store";
import type { ProjectStore } from "../../projects/project-store";
import type { AppStore } from "../app-store";
import type { AppAttachmentFence } from "./attachment-fence";
import { resolveAppGrant } from "./grant-resolver";

export class AppGrantAuthority {
  constructor(
    private readonly apps: AppStore,
    private readonly chats: ChatStore,
    private readonly projects: ProjectStore,
    private readonly fence: AppAttachmentFence
  ) {}

  grant(input: SetAppGrantInput) {
    return this.setState({ ...input, state: "grant" });
  }

  async setState(input: SetAppGrantStateInput): Promise<AppGrantSnapshot> {
    if (input.state === "clear") return this.revoke(input.target, input.appId);
    return this.fence.runGrant(input.target, input.appId, async () => {
      const app = this.requireAttachableApp(input.appId);
      await this.assertTargetAdmissible(input.target);
      const record = input.state === "disabled"
        ? ({
            appId: app.id,
            state: "disabled",
            disabledAt: Date.now(),
          } satisfies AppDisabledGrant)
        : this.makeGrant(
            app.id,
            app.domainIdentity,
            input.requestedDataLevel,
            input.requestedAgentDelegation
          );
      return this.writeTarget(input.target, record);
    });
  }

  async setDefaultGrant(input: SetDefaultAppGrantInput) {
    return this.fence.runDefaultGrant(input.appId, async () => {
      const app = this.requireAttachableApp(input.appId);
      const grant = input.grant
        ? this.makeGrant(
            app.id,
            app.domainIdentity,
            input.grant.requestedDataLevel,
            input.grant.requestedAgentDelegation
          )
        : null;
      return this.apps.setDefaultGrant(app.id, grant);
    });
  }

  async revoke(target: AppGrantTarget, appId: string): Promise<AppGrantSnapshot> {
    return this.fence.runClear(target, async () => {
      /* conversion 若先提交，clear 必须拒绝；否则删除 suppression 后，隐藏的
         inherited/global 正授权会在未来解绑时静默复活。 */
      await this.assertTargetAdmissible(target);
      if (target.kind === "chat") {
        const record = await this.chats.revokeAppGrant(target.chatId, appId);
        return { target, revision: record.grantRevision, grants: record.grants };
      }
      const project = await this.projects.revokeAppGrant(target.projectId, appId);
      return { target, revision: project.grantRevision, grants: project.grants };
    });
  }

  listSources(appId?: string): AppGrantSourcesSnapshot {
    const source = (
      kind: "chat" | "project",
      target: AppGrantTarget,
      targetName: string,
      revision: number,
      records: AppGrantRecord[]
    ): AppGrantSource[] => records
      .filter((record) => !appId || record.appId === appId)
      .map((record) => this.source(kind, target, targetName, revision, record));
    const sort = (left: AppGrantSource, right: AppGrantSource) =>
      left.targetName.localeCompare(right.targetName) ||
      left.appName.localeCompare(right.appName) ||
      left.appId.localeCompare(right.appId);
    const globals = this.apps.list().flatMap((app): AppGrantSource[] => {
      if (!app.defaultGrant || (appId && app.id !== appId)) return [];
      return [{
        source: "global",
        target: null,
        targetName: "所有 Chat/Project",
        revision: app.defaultGrantRevision ?? 0,
        appId: app.id,
        appName: this.appName(app.id),
        state: "grant",
        grant: structuredClone(app.defaultGrant),
        disabledAt: null,
        impact: "all-scopes",
      }];
    });
    return {
      chats: this.chats.list().flatMap((chat) => source(
        "chat",
        { kind: "chat", chatId: chat.id },
        chat.title ?? chat.id,
        chat.grantRevision,
        chat.grants
      )).sort(sort),
      projects: this.projects.list().flatMap((project) => source(
        "project",
        { kind: "project", projectId: project.id },
        project.name,
        project.grantRevision,
        project.grants
      )).sort(sort),
      globals: globals.sort(sort),
    };
  }

  async listAvailable(input: AvailableAppsInput): Promise<AvailableAttachedApp[]> {
    const context = await this.context(input.conversationId, input.conversationIncarnationId);
    if (!context) return [];
    const { chat, project } = context;
    const direct = byApp(chat.grants);
    const inherited = byApp(project?.grants ?? []);
    const ids = new Set([
      ...direct.keys(),
      ...inherited.keys(),
      ...this.apps.list().filter((app) => app.defaultGrant).map((app) => app.id),
    ]);
    return [...ids].flatMap((appId): AvailableAttachedApp[] => {
      const app = this.apps.get(appId);
      const generationId = app?.generationBinding.active?.generationId;
      if (!app || app.state !== "ready" || !generationId) return [];
      const resolved = resolveAppGrant({
        appId,
        chat: direct.get(appId),
        project: inherited.get(appId),
        global: app.defaultGrant,
      });
      /* Chat deny 仍是本 Chat 可管理的授权位：若把它过滤掉，用户就失去
         「clear → 恢复继承」的唯一入口。Project deny 不在 Chat 内伪装成可清。 */
      if (!resolved.effective && resolved.provenance.suppressedBy !== "chat") {
        return [];
      }
      return [{
        appId,
        name: app.manifest?.name ?? app.displayName,
        state: app.state,
        generationId,
        direct: resolved.provenance.contributors.includes("chat"),
        inherited: resolved.provenance.contributors.includes("project"),
        global: resolved.provenance.contributors.includes("global"),
        disabledBy: resolved.provenance.suppressedBy,
        effectiveGrant: resolved.effective
          ? structuredClone(resolved.effective)
          : null,
      }];
    }).sort((left, right) => left.name.localeCompare(right.name));
  }

  async effectiveGrants(chatId: string): Promise<EffectiveAppGrant[]> {
    const context = await this.context(chatId);
    if (!context) return [];
    const { chat, project } = context;
    const direct = byApp(chat.grants);
    const inherited = byApp(project?.grants ?? []);
    const ids = new Set([
      ...direct.keys(),
      ...inherited.keys(),
      ...this.apps.list().filter((app) => app.defaultGrant).map((app) => app.id),
    ]);
    return [...ids].flatMap((appId): EffectiveAppGrant[] => {
      const app = this.apps.get(appId);
      const binding = app?.generationBinding.active;
      const generation = app?.generations.find(
        (item) => item.generationId === binding?.generationId
      );
      const resolved = resolveAppGrant({
        appId,
        chat: direct.get(appId),
        project: inherited.get(appId),
        global: app?.defaultGrant,
      });
      if (!resolved.effective || !app || app.state !== "ready" || !binding || !generation) {
        return [];
      }
      return [{
        appId,
        grant: resolved.effective,
        provenance: {
          winner: resolved.provenance.winner!,
          contributors: resolved.provenance.contributors,
          suppressedBy: resolved.provenance.suppressedBy,
        },
        snapshot: {
          conversationId: chat.id,
          conversationIncarnationId: chat.incarnationId,
          chatGrantRevision: chat.grantRevision,
          projectId: chat.projectId,
          projectGrantRevision: project?.grantRevision ?? null,
          membershipRevision: project?.membershipRevision ?? 0,
          defaultGrantRevision: app.defaultGrantRevision ?? 0,
          appId,
          appLifecycleRevision: app.lifecycleRevision,
          appGenerationId: generation.generationId,
          appContentDigest: generation.contentDigest,
        },
      }];
    });
  }

  async effectiveGrant(chatId: string, appId: string) {
    return (await this.effectiveGrants(chatId)).find((item) => item.appId === appId);
  }

  async revokeEverywhere(appId: string) {
    for (const chat of this.chats.list()) {
      if (chat.grants.some((record) => record.appId === appId)) {
        await this.chats.revokeAppGrant(chat.id, appId);
      }
    }
    for (const project of this.projects.list()) {
      if (project.grants.some((record) => record.appId === appId)) {
        await this.projects.revokeAppGrant(project.id, appId);
      }
    }
  }

  private async context(chatId: string, incarnationId?: string) {
    const chat = await this.chats.get(chatId);
    if (!chat || (incarnationId && chat.incarnationId !== incarnationId)) {
      if (incarnationId) throw new Error("conversation incarnation 已变化");
      return null;
    }
    if (chat.appRole !== null) return null;
    const project = chat.projectId ? this.projects.get(chat.projectId) : undefined;
    if (project?.workspaceBinding.kind === "app") return null;
    return { chat, project };
  }

  private async writeTarget(target: AppGrantTarget, record: AppGrantRecord) {
    if (target.kind === "chat") {
      const chat = await this.chats.setAppGrantRecord(target.chatId, record);
      return { target, revision: chat.grantRevision, grants: chat.grants };
    }
    const project = await this.projects.setAppGrantRecord(target.projectId, record);
    return { target, revision: project.grantRevision, grants: project.grants };
  }

  private source(
    kind: "chat" | "project",
    target: AppGrantTarget,
    targetName: string,
    revision: number,
    record: AppGrantRecord
  ): AppGrantSource {
    const positive = isPositiveAppGrant(record);
    return {
      source: kind,
      target,
      targetName,
      revision,
      appId: record.appId,
      appName: this.appName(record.appId),
      state: positive ? "grant" : "disabled",
      grant: positive ? structuredClone(record) : null,
      disabledAt: positive ? null : record.disabledAt,
      impact: kind === "chat" ? "chat-only" : "project-members",
    };
  }

  private makeGrant(
    appId: string,
    domain: AppDomainIdentity | null,
    level: SetAppGrantInput["requestedDataLevel"],
    delegation: SetAppGrantInput["requestedAgentDelegation"] | undefined
  ): AppCapabilityGrant {
    if (!delegation) throw new Error("grant 动作缺少 Agent delegation");
    const data = this.dataGrant(domain, level);
    return {
      appId,
      ...(data ? { data } : {}),
      agentDelegation: structuredClone(delegation),
      grantedAt: Date.now(),
    };
  }

  private async assertTargetAdmissible(target: AppGrantTarget) {
    if (target.kind === "project") {
      const project = this.projects.get(target.projectId);
      if (!project) throw new Error("Project 不存在");
      if (project.workspaceBinding.kind === "app") throw new Error("App Project 不能再附加 App");
      return;
    }
    const chat = await this.chats.get(target.chatId);
    if (!chat) throw new Error("聊天不存在");
    if (chat.appRole !== null) throw new Error("App chat 不能再附加 App");
    const project = chat.projectId ? this.projects.get(chat.projectId) : undefined;
    if (project?.workspaceBinding.kind === "app") throw new Error("App Project 的聊天不能再附加 App");
  }

  private requireAttachableApp(appId: string) {
    const app = this.apps.get(appId);
    if (!app || app.state !== "ready" || !app.generationBinding.active) {
      throw new Error("App 非 ready 或缺少 active generation");
    }
    return app;
  }

  private appName(appId: string) {
    const app = this.apps.get(appId);
    return app?.manifest?.name ?? app?.displayName ?? appId;
  }

  private dataGrant(
    domain: AppDomainIdentity | null,
    level: SetAppGrantInput["requestedDataLevel"]
  ): AppCapabilityGrant["data"] {
    if (!level || level === "none") return undefined;
    if (!domain || domain.kind === "no-data") throw new Error("此 App 没有可授权的数据域");
    return { kind: "base", level };
  }
}

function byApp(records: readonly AppGrantRecord[]) {
  return new Map(records.map((record) => [record.appId, record]));
}
