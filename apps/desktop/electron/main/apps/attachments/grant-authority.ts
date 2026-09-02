/**
 * [INPUT]: Depends on AppStore compatibility-bound generations/Studio grants, ChatStore, ProjectStore, BaseGuiGrantStore, AppAttachmentFence, the ProjectsService publish boundary, nearest-scope grant-resolver, and shared Apps grant DTO
 * [OUTPUT]: Provides AppGrantAuthority with fenced grant/disable/clear, all-installed Chat management projection, nearest-scope effective grants, exact generation/content/compatibility-bound Studio-only projection, and Project mutation publication; exports the shared studioSurfaceReady predicate the renderer Gate consumes
 * [POS]: Sole durable App grant authority; ordinary AppRole chats stay excluded while the resident Studio lease consumes a separate exact-use projection
 */

import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppDisabledGrant,
  type AppDomainIdentity,
  type EffectiveAppGrant,
  type AppGrantRecord,
  type AppGrantCandidate,
  type AppGrantCandidatesInput,
  type AppGrantCommandTarget,
  type AppGrantSnapshot,
  type AppGrantSource,
  type AppGrantSourcesSnapshot,
  type AppGrantTarget,
  type AppRecord,
  type AvailableAppsInput,
  type AvailableAttachedApp,
  type SetAppGrantInput,
  type SetAppGrantStateInput,
  type SetDefaultAppGrantInput,
} from "../../../../shared/apps-ipc";
import type { ChatStore } from "../../chats/chat-store";
import type { ProjectStore } from "../../projects/store/project-store";
import type { AppStore } from "../app-store";
import type { BaseGuiGrantStore } from "../base-gui/grant-store";
import type { AppAttachmentFence } from "./attachment-fence";
import { resolveAppGrant } from "./grant-resolver";

export class AppGrantAuthority {
  constructor(
    private readonly apps: AppStore,
    private readonly chats: ChatStore,
    private readonly projects: ProjectStore,
    private readonly fence: AppAttachmentFence,
    private readonly publishProject: (projectId: string) => void = () => undefined,
    private readonly baseGuiGrants: Pick<BaseGuiGrantStore, "projection"> | null = null
  ) {}

  grant(input: SetAppGrantInput) {
    return this.setState({ ...input, state: "grant" });
  }

  async setState(input: SetAppGrantStateInput): Promise<AppGrantSnapshot> {
    const target = grantTargetOf(input.target);
    if (input.state === "clear") {
      return this.clear(input.target, input.appId);
    }
    return this.fence.runGrant(target, input.appId, async () => {
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
      return this.writeTarget(target, record);
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
    return this.clear(target, appId);
  }

  private async clear(
    checkedTarget: AppGrantTarget | AppGrantCommandTarget,
    appId: string
  ): Promise<AppGrantSnapshot> {
    const target = grantTargetOf(checkedTarget);
    return this.fence.runClear(target, async () => {
      /* conversion 若先提交，clear 必须拒绝；否则删除 suppression 后，隐藏的
         inherited/global 正授权会在未来解绑时静默复活。 */
      await this.assertTargetAdmissible(checkedTarget);
      if (target.kind === "chat") {
        const record = await this.chats.revokeAppGrant(target.chatId, appId);
        return { target, revision: record.grantRevision, grants: record.grants };
      }
      const project = await this.commitProjectGrant(target.projectId, () =>
        this.projects.revokeAppGrant(target.projectId, appId)
      );
      return { target, revision: project.grantRevision, grants: project.grants };
    });
  }

  listSources(appId?: string): AppGrantSourcesSnapshot {
    const source = (
      kind: "chat" | "project",
      target: AppGrantTarget,
      commandTarget: AppGrantCommandTarget | null,
      targetName: string,
      revision: number,
      records: AppGrantRecord[]
    ): AppGrantSource[] => records
      .filter((record) => !appId || record.appId === appId)
      .map((record) => this.source(
        kind,
        target,
        commandTarget,
        targetName,
        revision,
        record
      ));
    const sort = (left: AppGrantSource, right: AppGrantSource) =>
      left.targetName.localeCompare(right.targetName) ||
      left.appName.localeCompare(right.appName) ||
      left.appId.localeCompare(right.appId);
    const globals = this.apps.list().flatMap((app): AppGrantSource[] => {
      if (!app.defaultGrant || (appId && app.id !== appId)) return [];
      return [{
        source: "global",
        target: null,
        commandTarget: null,
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
        chat.incarnationId
          ? {
              kind: "chat",
              chatId: chat.id,
              expectedConversationIncarnationId: chat.incarnationId,
            }
          : null,
        chat.title ?? chat.id,
        chat.grantRevision,
        chat.grants
      )).sort(sort),
      projects: this.projects.list().flatMap((project) => source(
        "project",
        { kind: "project", projectId: project.id },
        {
          kind: "project",
          projectId: project.id,
          expectedProjectLifecycleRevision: project.projectLifecycleRevision,
        },
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
      ...this.apps.list().map((app) => app.id),
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
      /* Chat tab 是导航状态，不是授权状态。所有已安装且可运行的 App 都留在
         可管理投影中，即使当前无授权或被 Project/Chat 禁用，既有 tab 仍能打开
         统一授权入口。Agent 能力仍只从 effectiveGrants() 取正向授权。 */
      return [{
        appId,
        name: app.manifest?.name ?? app.displayName,
        state: app.state,
        generationId,
        effectiveSource: resolved.provenance.effectiveSource,
        suppressedBy: resolved.provenance.suppressedBy,
        effectiveGrant: resolved.effective
          ? structuredClone(resolved.effective)
          : null,
      }];
    }).sort((left, right) => left.name.localeCompare(right.name));
  }

  async listCandidates(input: AppGrantCandidatesInput): Promise<AppGrantCandidate[]> {
    const context = await this.commandContext(input.target);
    const scope = byApp(
      input.target.kind === "chat" ? context.chat!.grants : context.project!.grants
    );
    const project = byApp(
      input.target.kind === "chat" ? context.project?.grants ?? [] : []
    );
    return this.apps.list().map((app): AppGrantCandidate => {
      const scopeRecord = scope.get(app.id);
      const inherited = resolveAppGrant({
        appId: app.id,
        project: project.get(app.id),
        global: app.defaultGrant,
      });
      const resolved = input.target.kind === "chat"
        ? resolveAppGrant({
            appId: app.id,
            chat: scopeRecord,
            project: project.get(app.id),
            global: app.defaultGrant,
          })
        : resolveAppGrant({
            appId: app.id,
            project: scopeRecord,
            global: app.defaultGrant,
          });
      return {
        appId: app.id,
        name: app.manifest?.name ?? app.displayName,
        icon: app.manifest?.icon ?? null,
        state: app.state,
        generationId: app.generationBinding.active?.generationId ?? null,
        domainIdentity: structuredClone(app.domainIdentity),
        scopeRecord: scopeRecord ? structuredClone(scopeRecord) : null,
        inheritedGrant: inherited.effective
          ? structuredClone(inherited.effective)
          : null,
        inheritedSource: inherited.provenance.effectiveSource === "project" ||
          inherited.provenance.effectiveSource === "global"
          ? inherited.provenance.effectiveSource
          : null,
        effectiveGrant: resolved.effective
          ? structuredClone(resolved.effective)
          : null,
        effectiveSource: resolved.provenance.effectiveSource,
        suppressedBy: resolved.provenance.suppressedBy,
      };
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
          effectiveSource: resolved.provenance.effectiveSource!,
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

  /**
   * Studio 的 use chat 属于 App 自己的数据面，不是“在 chat 上附加 App”。
   * 因此这里只消费 exact App Project + generation-bound Studio grant，绝不读取
   * project/default grant，也不把 AppRole 放进 ordinary effectiveGrants。
   */
  async studioSurfaceGrant(chatId: string, appId: string) {
    const chat = this.chats.getMetadata(chatId);
    if (!chat || chat.appRole !== "use" || !chat.projectId) return undefined;
    const project = this.projects.get(chat.projectId);
    if (
      !project ||
      project.workspaceBinding.kind !== "app" ||
      project.workspaceBinding.appId !== appId
    ) {
      return undefined;
    }
    const app = this.apps.get(appId);
    if (
      app?.activeUseChatSlot?.id !== chat.id ||
      app.activeUseChatSlot.state !== "canonical"
    ) {
      return undefined;
    }
    const binding = app?.generationBinding.active;
    const generation = app?.generations.find(
      (item) => item.generationId === binding?.generationId
    );
    const studio = app?.studioGrant;
    const guiDecision = this.baseGuiDecisionProjection(appId, binding?.generationId);
    /* 判据只有一份：Gate 的 studioSurfaceReady 投影与这里读同一个函数。
       renderer 从前自己比 generationId + contentDigest 两项，兼容重绑后
       它说「已授权」而这里 403——两个真相源必然在某一天各说各话。 */
    if (!app || !binding || !generation || !studio || !studioSurfaceReady(app, guiDecision)) {
      return undefined;
    }
    return {
      appId,
      grant: {
        appId,
        data: structuredClone(studio.data),
        agentDelegation: structuredClone(studio.agentDelegation),
        grantedAt: studio.grantedAt,
      },
      snapshot: {
        conversationId: chat.id,
        conversationIncarnationId: chat.incarnationId,
        chatGrantRevision: chat.grantRevision,
        projectId: project.id,
        projectGrantRevision: project.grantRevision,
        membershipRevision: project.membershipRevision,
        defaultGrantRevision: app.defaultGrantRevision ?? 0,
        appId,
        appLifecycleRevision: app.lifecycleRevision,
        appGenerationId: generation.generationId,
        appContentDigest: generation.contentDigest,
        studioGrantRevision: app.studioGrantRevision ?? 0,
        baseGuiDecisionRevision: guiDecision?.revision ?? 0,
      },
    };
  }

  async revokeEverywhere(appId: string) {
    for (const chat of this.chats.list()) {
      if (chat.grants.some((record) => record.appId === appId)) {
        await this.chats.revokeAppGrant(chat.id, appId);
      }
    }
    for (const project of this.projects.list()) {
      if (project.grants.some((record) => record.appId === appId)) {
        await this.commitProjectGrant(project.id, () =>
          this.projects.revokeAppGrant(project.id, appId)
        );
      }
    }
  }

  private async context(chatId: string, incarnationId?: string) {
    const chat = this.chats.getMetadata(chatId);
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
    const project = await this.commitProjectGrant(target.projectId, () =>
      this.projects.setAppGrantRecord(target.projectId, record)
    );
    return { target, revision: project.grantRevision, grants: project.grants };
  }

  /** Store mutation and renderer publication are one commit boundary. */
  private async commitProjectGrant<T>(
    projectId: string,
    mutate: () => Promise<T>
  ): Promise<T> {
    const result = await mutate();
    this.publishProject(projectId);
    return result;
  }

  private source(
    kind: "chat" | "project",
    target: AppGrantTarget,
    commandTarget: AppGrantCommandTarget | null,
    targetName: string,
    revision: number,
    record: AppGrantRecord
  ): AppGrantSource {
    const positive = isPositiveAppGrant(record);
    return {
      source: kind,
      target,
      commandTarget,
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

  private async commandContext(target: AppGrantCommandTarget) {
    await this.assertTargetAdmissible(target);
    if (target.kind === "project") {
      return { project: this.projects.get(target.projectId), chat: undefined };
    }
    const chat = this.chats.getMetadata(target.chatId);
    const project = chat?.projectId ? this.projects.get(chat.projectId) : undefined;
    return { chat, project };
  }

  private async assertTargetAdmissible(
    target: AppGrantTarget | AppGrantCommandTarget
  ) {
    if (target.kind === "project") {
      const project = this.projects.get(target.projectId);
      if (!project) throw new Error("Project 不存在");
      if (
        "expectedProjectLifecycleRevision" in target &&
        project.projectLifecycleRevision !== target.expectedProjectLifecycleRevision
      ) {
        throw Object.assign(new Error("Project lifecycle 已变化，请刷新后重试"), {
          status: 409,
        });
      }
      if (project.archivedAt || project.deletionCheckpoint) {
        throw Object.assign(new Error("Project 当前不可用"), { status: 409 });
      }
      if (project.workspaceBinding.kind === "app") throw new Error("App Project 不能再附加 App");
      return;
    }
    const chat = this.chats.getMetadata(target.chatId);
    if (!chat) throw new Error("聊天不存在");
    if (
      "expectedConversationIncarnationId" in target &&
      chat.incarnationId !== target.expectedConversationIncarnationId
    ) {
      throw Object.assign(
        new Error("APP_INCARNATION_STALE: conversation incarnation 已变化，请刷新后重试"),
        { status: 409 }
      );
    }
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

  /** Studio 面的就绪投影：与 studioSurfaceGrant 同源，供 renderer Gate 消费。 */
  studioSurfaceReadyFor(app: AppRecord) {
    return studioSurfaceReady(
      app,
      this.baseGuiDecisionProjection(
        app.id,
        app.generationBinding.active?.generationId
      )
    );
  }

  private baseGuiDecisionProjection(
    appId: string,
    generationId: string | undefined
  ) {
    return generationId && this.baseGuiGrants
      ? this.baseGuiGrants.projection(appId, generationId)
      : null;
  }
}

type BaseGuiDecisionProjection = ReturnType<BaseGuiGrantStore["projection"]>;

/* ============================================================
 * Studio 面能否开出来，是八条事实的合取，不是两条
 *
 * generationId + contentDigest 只证「这份字节被批准过」；兼容重绑会换掉
 * compatibilityRefDigest 与 decision revision，字节没动而授权已过期。
 * 谁少读一条，谁就会在界面上说「已授权」，然后让 surface 去 403。
 * 因此判据落成一个纯函数：main 用它决定放不放行，renderer 用它的结果
 * 决定画不画 Gate——一份事实，两处消费，永不各算各的。
 * ============================================================ */
export function studioSurfaceReady(
  app: AppRecord,
  guiDecision: BaseGuiDecisionProjection | null
) {
  const binding = app.generationBinding.active;
  const generation = app.generations.find(
    (item) => item.generationId === binding?.generationId
  );
  const studio = app.studioGrant;
  return Boolean(
    app.state === "ready" &&
      binding &&
      generation &&
      studio &&
      studio.generationId === generation.generationId &&
      studio.contentDigest === generation.contentDigest &&
      generation.compatibilityRefDigest &&
      studio.compatibilityRefDigest === generation.compatibilityRefDigest &&
      !(
        guiDecision?.decision &&
        guiDecision.decision.compatibilityRefDigest !==
          generation.compatibilityRefDigest
      ) &&
      studio.baseGuiDecisionRevision === (guiDecision?.revision ?? 0) &&
      studio.baseGuiDecisionId === (guiDecision?.decision?.decisionId ?? null) &&
      !guiDecision?.revokedAt
  );
}

function grantTargetOf(
  target: AppGrantTarget | AppGrantCommandTarget
): AppGrantTarget {
  return target.kind === "chat"
    ? { kind: "chat", chatId: target.chatId }
    : { kind: "project", projectId: target.projectId };
}

function byApp(records: readonly AppGrantRecord[]) {
  return new Map(records.map((record) => [record.appId, record]));
}
