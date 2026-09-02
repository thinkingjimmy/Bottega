/**
 * [INPUT]: Depends on node: crypto, shared ownerKey/BaseMeta, canonical chat References to database data, BaseStore, three-dimensional positioning, project
 * [OUTPUT]: Provides MutationPrincipal, BaseChatRef and BaseOwnerResolver; Project identity carries creation-time Base navigation while ordinary generic-Base resolution stays separate from authorized App attachment resolution
 * [POS]: The owner rule of bases is one point; IPC/toolset/sections/search not to copy the "self-prioritize, project backtrack" section
 */

import { randomUUID } from "node:crypto";
import {
  ownerFromKey,
  ownerKeyOf,
  type BaseMeta,
} from "../../../shared/bases-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
import type { EffectiveAppGrant } from "../../../shared/apps-ipc";
import type { Project } from "../../../shared/projects-ipc";
import { baseNavigationForProject } from "../../../shared/placement/base";
import {
  chatOwnerIdentity,
  type BaseOwnerIdentity,
  type BaseStore,
} from "./base-store";

export type BaseLeaseIdentity = {
  chatId: string;
  incarnationId: string;
};

/** owner 解析只需要身份/归属四字段；恒走内存元数据，禁止为此读全量账本。 */
export type BaseChatRef = Pick<
  ChatRecord,
  "id" | "incarnationId" | "title" | "projectId" | "context"
>;

export type BaseOwnerResolverOptions = {
  getChat(chatId: string): Promise<BaseChatRef | null>;
  getProject(
    projectId: string
  ): Pick<Project, "id" | "name"> &
    Partial<Pick<Project, "archivedAt" | "workspaceBinding" | "role">> | undefined;
};

export type MutationPrincipal =
  | { kind: "owner" }
  | { kind: "project-member" }
  | {
      kind: "app-attachment";
      appId: string;
      level: "read" | "row-write";
      provenance: EffectiveAppGrant["provenance"];
      snapshot: EffectiveAppGrant["snapshot"];
    };

export type AppBaseAttachmentProvider = {
  effectiveGrant(chatId: string, appId: string): Promise<EffectiveAppGrant | undefined>;
  projectForApp(appId: string): { id: string; name: string } | undefined;
};

export class BaseOwnerResolver {
  private appAttachments: AppBaseAttachmentProvider | null = null;

  constructor(
    private readonly store: BaseStore,
    private readonly options: BaseOwnerResolverOptions
  ) {}

  configureAppAttachments(provider: AppBaseAttachmentProvider) {
    if (this.appAttachments) throw new Error("Base App attachment provider 已配置");
    this.appAttachments = provider;
  }

  async chat(chatId: string) {
    const chat = await this.options.getChat(chatId);
    if (!chat) throw statusError(404, "聊天不存在");
    return chat;
  }

  async identityForOwnerKey(ownerKey: string): Promise<BaseOwnerIdentity> {
    const ref = ownerFromKey(ownerKey);
    if (ref.kind === "chat") {
      return chatOwnerIdentity(await this.chatIdentity(ref.chatId));
    }
    const project = this.options.getProject(ref.projectId);
    if (!project) throw statusError(404, "Project 不存在");
    const located = this.store.locate(ownerKey);
    const currentNavigation = located.status === "healthy"
      ? this.store.peek(ownerKey, located.ownerInstanceId)?.meta.navigation
      : undefined;
    return {
      owner: { kind: "project", projectId: project.id },
      ownerInstanceId:
        located.status === "corrupt"
          ? located.ownerInstanceId || randomUUID()
          : located.ownerInstanceId,
      title: project.name,
      navigation: baseNavigationForProject(project, currentNavigation),
    };
  }

  /**
   * Section 解析同时是 App Edit/Use chat 走进 App Base 的那条路：guard 放在这里，
   * 于是 `base_*` 工具、附件写入与跨 Section 读一次全部收口。
   */
  async resolveTargetForSection(sectionId: string) {
    const chat = await this.chat(sectionId);
    if (chat.context.kind !== "ordinary") {
      throw statusError(403, "App Use/Edit chats do not expose the generic Base panel");
    }
    const own = chatOwnerIdentity({
      chatId: chat.id,
      incarnationId: chat.incarnationId,
      title: chat.title,
    });
    const ownKey = ownerKeyOf(own.owner);
    if (this.store.locate(ownKey, own.ownerInstanceId).status !== "absent") {
      return own;
    }
    if (chat.projectId) {
      const projectKey = `project:${chat.projectId}`;
      if (this.store.locate(projectKey).status !== "absent") {
        return this.identityForOwnerKey(projectKey);
      }
    }
    return own;
  }

  async resolveTargetForLease(lease: BaseLeaseIdentity) {
    const chat = await this.chat(lease.chatId);
    if (chat.incarnationId !== lease.incarnationId) {
      throw statusError(409, "工具 lease 已过期：chat incarnation 已变化");
    }
    return this.resolveTargetForSection(chat.id);
  }

  async resolvePrincipal(
    meta: BaseMeta,
    lease: BaseLeaseIdentity,
    appId?: string
  ): Promise<MutationPrincipal | null> {
    const chat = await this.options.getChat(lease.chatId);
    if (!chat || chat.incarnationId !== lease.incarnationId) return null;
    if (appId) {
      const effective = await this.requireAppAttachments().effectiveGrant(
        lease.chatId,
        appId
      );
      if (
        !effective ||
        effective.grant.data?.kind !== "base"
      ) {
        return null;
      }
      const project = this.requireAppAttachments().projectForApp(appId);
      if (
        !project ||
        meta.owner.kind !== "project" ||
        meta.owner.projectId !== project.id
      ) {
        return null;
      }
      return {
        kind: "app-attachment",
        appId,
        level: effective.grant.data.level,
        provenance: effective.provenance,
        snapshot: effective.snapshot,
      };
    }
    if (meta.owner.kind === "chat") {
      return (
        meta.owner.chatId === lease.chatId &&
        meta.owner.incarnationId === lease.incarnationId &&
        meta.ownerInstanceId === lease.incarnationId
      ) ? { kind: "owner" } : null;
    }
    return chat.projectId === meta.owner.projectId
      ? { kind: "project-member" }
      : null;
  }

  async assertCanMutate(meta: BaseMeta, lease: BaseLeaseIdentity, appId?: string) {
    const principal = await this.resolvePrincipal(meta, lease, appId);
    if (!principal) {
      throw statusError(403, "当前 chat 无权写入该 Base");
    }
    return principal;
  }

  async resolveTargetForApp(appId: string, lease: BaseLeaseIdentity) {
    const chat = await this.chat(lease.chatId);
    if (chat.incarnationId !== lease.incarnationId) {
      throw statusError(409, "工具 lease 已过期：chat incarnation 已变化");
    }
    const effective = await this.requireAppAttachments().effectiveGrant(
      lease.chatId,
      appId
    );
    if (!effective || effective.grant.data?.kind !== "base") {
      throw statusError(403, "当前 chat 未获该 App 的 Base 授权");
    }
    const project = this.requireAppAttachments().projectForApp(appId);
    if (!project) throw statusError(404, "App Base Project 不存在");
    return this.identityForOwnerKey(`project:${project.id}`);
  }

  assertOwnerKeyForApp(ownerKey: string, appId: string) {
    if (ownerKey !== this.ownerKeyForApp(appId)) {
      throw statusError(403, "App window cannot access another Base owner");
    }
    return ownerKey;
  }

  ownerKeyForApp(appId: string) {
    const project = this.requireAppAttachments().projectForApp(appId);
    if (!project) throw statusError(404, "App Base Project does not exist");
    return `project:${project.id}`;
  }

  private async chatIdentity(chatId: string) {
    const chat = await this.chat(chatId);
    return {
      chatId: chat.id,
      incarnationId: chat.incarnationId,
      title: chat.title,
    };
  }

  private requireAppAttachments() {
    if (!this.appAttachments) {
      throw statusError(503, "App attachment authority 尚未初始化");
    }
    return this.appAttachments;
  }
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
