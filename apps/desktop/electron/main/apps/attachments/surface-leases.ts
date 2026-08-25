/**
 * [INPUT]: Depends on AppStore, ProjectStore, AppGrantAuthority and shared surface DTO
 * [OUTPUT]: Provides AppAttachmentSurfaceLeaseRegistry; The same drift determination is used to describe the area adapter by the conversation/incarnation/generation/digest/lifecycle/grant, and to describe the area adapter
 * [POS]: The main-only UI capability registry of apps/attachments; slot/grant not equal to surface, generation promote/revoke
 */

import { randomUUID } from "node:crypto";
import type {
  AppAttachmentSurface,
  AppSurfaceAcquireInput,
} from "../../../../shared/apps-ipc";
import type { BaseMutationOperation } from "../../../../shared/bases-ipc";
import type { ProjectStore } from "../../projects/project-store";
import type { AppStore } from "../app-store";
import type { AppGrantAuthority } from "./grant-authority";

/* 这个 registry 只需要「这条 conversation 对这个 App 的有效 grant」与「App 的
   Base Project 是谁」两件事。把依赖收窄成端口而不是整个 Store：边界显式，
   fence 的每一条漂移也才能被单独驱动。 */
export type SurfaceGrantSource = Pick<AppGrantAuthority, "effectiveGrant">;
export type SurfaceProjectSource = Pick<ProjectStore, "findByAppId">;

export class AppAttachmentSurfaceLeaseRegistry {
  private readonly leases = new Map<string, {
    surface: AppAttachmentSurface;
    grantRevisionKey: string;
  }>();

  constructor(
    private readonly apps: AppStore,
    private readonly projects: SurfaceProjectSource,
    private readonly grants: SurfaceGrantSource
  ) {}

  async acquire(input: AppSurfaceAcquireInput) {
    const effective = await this.grants.effectiveGrant(
      input.conversationId,
      input.appId
    );
    if (
      !effective ||
      effective.snapshot.conversationIncarnationId !==
        input.conversationIncarnationId
    ) {
      throw statusError(403, "当前 conversation incarnation 没有 App surface grant");
    }
    const app = this.apps.get(input.appId);
    const active = app?.generationBinding.active;
    const generation = app?.generations.find(
      (item) => item.generationId === active?.generationId
    );
    if (
      !app ||
      app.state !== "ready" ||
      !app.domainIdentity ||
      !active ||
      !generation
    ) {
      throw statusError(409, "App generation 当前不可签发 surface");
    }
    const ownerKey = app.domainIdentity.kind === "base" &&
      app.domainIdentity.domain.kind === "ordinary"
      ? this.ownerKey(input.appId)
      : null;
    const surface: AppAttachmentSurface = {
      surfaceLeaseId: randomUUID(),
      conversationId: input.conversationId,
      conversationIncarnationId: input.conversationIncarnationId,
      appId: input.appId,
      generationId: generation.generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision: app.lifecycleRevision,
      domainIdentity: structuredClone(app.domainIdentity),
      dataGrant: structuredClone(effective.grant.data ?? null),
      ownerKey,
    };
    this.leases.set(surface.surfaceLeaseId, {
      surface,
      grantRevisionKey: revisionKey(effective.snapshot),
    });
    return structuredClone(surface);
  }

  release(surfaceLeaseId: string) {
    this.leases.delete(surfaceLeaseId);
  }

  /** 逐请求复核入口；UI 与 mutation 共用同一条 generation/grant 漂移判据。 */
  describe(surfaceLeaseId: string) {
    return this.requireLive(surfaceLeaseId);
  }

  revokeApp(appId: string) {
    for (const [leaseId, lease] of this.leases) {
      if (lease.surface.appId === appId) this.leases.delete(leaseId);
    }
  }

  count(appId: string, generationId?: string) {
    return [...this.leases.values()].filter(
      ({ surface }) =>
        surface.appId === appId &&
        (!generationId || surface.generationId === generationId)
    ).length;
  }

  async validateMutation(input: {
    surfaceLeaseId: string;
    ownerKey: string;
    operation: BaseMutationOperation;
  }) {
    const lease = await this.requireLive(input.surfaceLeaseId);
    if (
      lease.ownerKey !== input.ownerKey ||
      lease.domainIdentity.kind !== "base" ||
      lease.domainIdentity.domain.kind !== "ordinary" ||
      lease.dataGrant?.kind !== "base" ||
      lease.dataGrant.level !== "row-write" ||
      input.operation === "meta" ||
      input.operation === "json-import"
    ) {
      throw statusError(403, "App surface 不允许此 Base mutation");
    }
    return lease;
  }

  private async requireLive(surfaceLeaseId: string) {
    const stored = this.leases.get(surfaceLeaseId);
    if (!stored) throw statusError(403, "App surface lease 无效");
    const lease = stored.surface;
    const app = this.apps.get(lease.appId);
    const active = app?.generationBinding.active;
    const generation = app?.generations.find(
      (item) => item.generationId === active?.generationId
    );
    const effective = await this.grants.effectiveGrant(
      lease.conversationId,
      lease.appId
    );
    if (
      !app ||
      app.state !== "ready" ||
      app.lifecycleRevision !== lease.lifecycleRevision ||
      generation?.generationId !== lease.generationId ||
      generation.contentDigest !== lease.contentDigest ||
      effective?.snapshot.conversationIncarnationId !==
        lease.conversationIncarnationId ||
      !effective ||
      revisionKey(effective.snapshot) !== stored.grantRevisionKey
    ) {
      this.leases.delete(surfaceLeaseId);
      throw statusError(409, "App surface lease 已因 grant/incarnation/generation 变化失效");
    }
    return structuredClone(lease);
  }

  private ownerKey(appId: string) {
    const project = this.projects.findByAppId(appId);
    if (!project) throw statusError(404, "App Base Project 不存在");
    return `project:${project.id}`;
  }
}

function revisionKey(snapshot: {
  chatGrantRevision: number;
  projectId: string | null;
  projectGrantRevision: number | null;
  membershipRevision: number;
  defaultGrantRevision: number;
}) {
  return [
    snapshot.chatGrantRevision,
    snapshot.projectId ?? "no-project",
    snapshot.projectGrantRevision ?? -1,
    snapshot.membershipRevision,
    snapshot.defaultGrantRevision,
  ].join(":");
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
