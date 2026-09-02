/**
 * [INPUT]: Depends on AppStore, ProjectStore, AppGrantAuthority ordinary/Studio projections, the canonical effective-workspace resolver, trusted renderer residence, and shared surface DTOs
 * [OUTPUT]: Provides AppAttachmentSurfaceLeaseRegistry with exact chat-tab/Studio authorization, cutover-derived runtime leases, read-only staging/draining generations, active-only mutation fencing, renderer ownership, drift revalidation, and bounded tombstones
 * [POS]: Main-only UI capability registry for apps/attachments; a slot or grant never substitutes for a live surface lease
 */

import { randomUUID } from "node:crypto";
import type {
  AppAttachmentSurface,
  AppSurfaceAcquireInput,
} from "../../../../shared/apps-ipc";
import type { BaseMutationOperation } from "../../../../shared/bases-ipc";
import type { ProjectStore } from "../../projects/store/project-store";
import type { AppStore } from "../app-store";
import type { AppGrantAuthority } from "./grant-authority";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import type { EffectiveWorkspaceResolver } from "../../workspace-resolver";

/* 这个 registry 只需要「这条 conversation 对这个 App 的有效 grant」与「App 的
   Base Project 是谁」两件事。把依赖收窄成端口而不是整个 Store：边界显式，
   fence 的每一条漂移也才能被单独驱动。 */
export type SurfaceGrantSource = Pick<
  AppGrantAuthority,
  "effectiveGrant" | "studioSurfaceGrant"
>;
export type SurfaceProjectSource = Pick<ProjectStore, "findByAppId">;

export class AppAttachmentSurfaceLeaseRegistry {
  private readonly leases = new Map<string, {
    surface: AppAttachmentSurface;
    grantRevisionKey: string;
    renderer: Readonly<{
      windowId: string;
      webContentsId: number;
      rendererIncarnation: string;
    }> | null;
    stagingGenerationId: string | null;
    sourceSurfaceLeaseId: string | null;
  }>();
  private readonly tombstones = new Map<string, number>();
  private resolveEffectiveWorkspace: EffectiveWorkspaceResolver | null = null;
  private isStagingGeneration: (appId: string, generationId: string) => boolean =
    () => false;
  private static readonly TOMBSTONE_TTL_MS = 15 * 60_000;
  private static readonly TOMBSTONE_LIMIT = 2_048;

  constructor(
    private readonly apps: AppStore,
    private readonly projects: SurfaceProjectSource,
    private readonly grants: SurfaceGrantSource
  ) {}

  configureWorkspaceAuthority(resolve: EffectiveWorkspaceResolver) {
    if (this.resolveEffectiveWorkspace) {
      throw new Error("App surface workspace authority 已配置");
    }
    this.resolveEffectiveWorkspace = resolve;
  }

  configureStagingGeneration(
    resolve: (appId: string, generationId: string) => boolean
  ) {
    this.isStagingGeneration = resolve;
  }

  async acquire(
    input: AppSurfaceAcquireInput,
    context?: TrustedRendererContext
  ) {
    const effective = await this.surfaceGrant(input);
    if (
      !effective ||
      effective.snapshot.conversationIncarnationId !==
        input.conversationIncarnationId
    ) {
      throw statusError(403, "当前 conversation incarnation 没有 App surface grant");
    }
    const app = this.apps.get(input.appId);
    if (
      app?.activeUseSwitch &&
      app.activeUseSwitch.phase !== "issuance-open" &&
      app.activeUseSwitch.phase !== "completed"
    ) {
      throw statusError(409, "App conversation residence is still switching");
    }
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
    const workspaceAuthorityIdentity = this.workspaceAuthority(
      input.conversationId,
      409
    );
    const ownerKey = app.domainIdentity.kind === "base" &&
      app.domainIdentity.domain.kind === "ordinary"
      ? this.ownerKey(input.appId)
      : null;
    const surface: AppAttachmentSurface = {
      surfaceLeaseId: randomUUID(),
      conversationId: input.conversationId,
      conversationIncarnationId: input.conversationIncarnationId,
      appId: input.appId,
      mode: input.mode,
      generationId: generation.generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision: app.lifecycleRevision,
      workspaceAuthorityIdentity,
      domainIdentity: structuredClone(app.domainIdentity),
      dataGrant: structuredClone(effective.grant.data ?? null),
      ownerKey,
    };
    this.leases.set(surface.surfaceLeaseId, {
      surface,
      grantRevisionKey: revisionKey(effective.snapshot),
      renderer: context
        ? {
            windowId: context.windowId,
            webContentsId: context.webContentsId,
            rendererIncarnation: context.rendererIncarnation,
          }
        : null,
      stagingGenerationId: null,
      sourceSurfaceLeaseId: null,
    });
    return structuredClone(surface);
  }

  async stage(surfaceLeaseId: string, generationId: string) {
    const source = await this.requireLive(surfaceLeaseId, false);
    const stored = this.leases.get(surfaceLeaseId);
    const app = this.apps.get(source.appId);
    const generation = app?.generations.find(
      (item) => item.generationId === generationId
    );
    if (
      !stored ||
      !app ||
      !generation ||
      (app.generationBinding.pending?.generationId !== generationId &&
        app.generationBinding.active?.generationId !== generationId) ||
      !this.isStagingGeneration(source.appId, generationId)
    ) {
      throw statusError(409, "App generation 当前不可签发 staging surface");
    }
    const surface: AppAttachmentSurface = {
      ...source,
      surfaceLeaseId: randomUUID(),
      generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision:
        app.generationBinding.active?.generationId === generationId
          ? app.lifecycleRevision
          : app.lifecycleRevision + 1,
    };
    this.leases.set(surface.surfaceLeaseId, {
      surface,
      grantRevisionKey: stored.grantRevisionKey,
      renderer: stored.renderer,
      stagingGenerationId: generationId,
      sourceSurfaceLeaseId: surfaceLeaseId,
    });
    return structuredClone(surface);
  }

  release(surfaceLeaseId: string) {
    if (this.leases.delete(surfaceLeaseId)) this.rememberGone(surfaceLeaseId);
  }

  releaseDerived(surfaceLeaseId: string) {
    const stored = this.leases.get(surfaceLeaseId);
    if (!stored?.sourceSurfaceLeaseId) return false;
    this.release(surfaceLeaseId);
    return true;
  }

  releaseFromRenderer(
    surfaceLeaseId: string,
    context: TrustedRendererContext
  ) {
    const stored = this.leases.get(surfaceLeaseId);
    if (!stored || !this.rendererMatches(stored.renderer, context)) return false;
    this.release(surfaceLeaseId);
    return true;
  }

  rendererSurfaceForRelease(
    surfaceLeaseId: string,
    context: TrustedRendererContext
  ) {
    const stored = this.leases.get(surfaceLeaseId);
    return stored && this.rendererMatches(stored.renderer, context)
      ? structuredClone(stored.surface)
      : null;
  }

  revokeWindow(windowId: string) {
    for (const [leaseId, stored] of this.leases) {
      if (stored.renderer?.windowId === windowId) this.release(leaseId);
    }
  }

  /** 逐请求复核入口；UI 与 mutation 共用同一条 generation/grant 漂移判据。 */
  describe(surfaceLeaseId: string) {
    return this.requireLive(surfaceLeaseId, false);
  }

  revokeApp(appId: string) {
    for (const [leaseId, lease] of this.leases) {
      if (lease.surface.appId === appId) {
        this.leases.delete(leaseId);
        this.rememberGone(leaseId);
      }
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
    const lease = await this.requireLive(input.surfaceLeaseId, true);
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

  private async requireLive(surfaceLeaseId: string, requireActive = false) {
    const stored = this.leases.get(surfaceLeaseId);
    if (!stored) {
      this.pruneTombstones();
      throw statusError(
        this.tombstones.has(surfaceLeaseId) ? 410 : 401,
        this.tombstones.has(surfaceLeaseId)
          ? "App surface lease 已撤销"
          : "App surface lease 无效"
      );
    }
    const lease = stored.surface;
    if (stored.renderer) {
      try {
        const residence = {
          windowId: stored.renderer.windowId,
          conversationId: lease.conversationId,
          conversationIncarnationId: lease.conversationIncarnationId,
        };
        if (lease.mode === "studio") {
          surfaceWindowController.assertSurfaceResidence({
            ...residence,
            appId: lease.appId,
          });
        } else {
          surfaceWindowController.assertConversationSurfaceResidence(residence);
        }
      } catch {
        this.leases.delete(surfaceLeaseId);
        this.rememberGone(surfaceLeaseId);
        throw statusError(410, "App surface lease 已因 surface residence 变化失效");
      }
    }
    const app = this.apps.get(lease.appId);
    const active = app?.generationBinding.active;
    const generation = app?.generations.find(
      (item) => item.generationId === lease.generationId
    );
    const isActive = active?.generationId === lease.generationId;
    const isDraining = Boolean(
      app?.generationBinding.drainingGenerationIds.includes(lease.generationId)
    );
    const isStaging = this.isStagingGeneration(lease.appId, lease.generationId);
    const workspaceAuthorityIdentity = this.workspaceAuthority(
      lease.conversationId,
      410
    );
    /* A promoted generation must not turn the old iframe into an abrupt 410.
       Its exact sealed generation may finish reads while renderer double-buffering
       converges, but mutations still require the current active lifecycle fence. */
    if (
      !requireActive &&
      app?.state === "ready" &&
      generation?.contentDigest === lease.contentDigest &&
      isStaging &&
      workspaceAuthorityIdentity === lease.workspaceAuthorityIdentity
    ) {
      const effective = await this.surfaceGrant(lease);
      if (
        effective?.snapshot.conversationIncarnationId !==
          lease.conversationIncarnationId ||
        !effective ||
        revisionKey(effective.snapshot) !== stored.grantRevisionKey
      ) {
        this.leases.delete(surfaceLeaseId);
        this.rememberGone(surfaceLeaseId);
        throw statusError(410, "App staging surface lease 已因 grant 变化失效");
      }
      return structuredClone(lease);
    }
    if (
      !requireActive &&
      app?.state === "ready" &&
      generation?.contentDigest === lease.contentDigest &&
      isDraining &&
      workspaceAuthorityIdentity === lease.workspaceAuthorityIdentity
    ) {
      return structuredClone(lease);
    }
    const effective = await this.surfaceGrant(lease);
    if (
      isActive &&
      stored.stagingGenerationId === lease.generationId &&
      effective?.snapshot.conversationIncarnationId === lease.conversationIncarnationId
    ) {
      stored.grantRevisionKey = revisionKey(effective.snapshot);
      stored.stagingGenerationId = null;
    }
    if (
      !app ||
      app.state !== "ready" ||
      !isActive ||
      app.lifecycleRevision !== lease.lifecycleRevision ||
      generation?.contentDigest !== lease.contentDigest ||
      effective?.snapshot.conversationIncarnationId !==
        lease.conversationIncarnationId ||
      !effective ||
      revisionKey(effective.snapshot) !== stored.grantRevisionKey ||
      workspaceAuthorityIdentity !== lease.workspaceAuthorityIdentity
    ) {
      this.leases.delete(surfaceLeaseId);
      this.rememberGone(surfaceLeaseId);
      throw statusError(410, "App surface lease 已因 grant/incarnation/generation 变化失效");
    }
    return structuredClone(lease);
  }

  private rememberGone(surfaceLeaseId: string) {
    this.pruneTombstones();
    this.tombstones.set(
      surfaceLeaseId,
      Date.now() + AppAttachmentSurfaceLeaseRegistry.TOMBSTONE_TTL_MS
    );
    while (
      this.tombstones.size >
      AppAttachmentSurfaceLeaseRegistry.TOMBSTONE_LIMIT
    ) {
      const oldest = this.tombstones.keys().next().value as string | undefined;
      if (!oldest) break;
      this.tombstones.delete(oldest);
    }
  }

  private rendererMatches(
    renderer: Readonly<{
      windowId: string;
      webContentsId: number;
      rendererIncarnation: string;
    }> | null,
    context: TrustedRendererContext
  ) {
    return Boolean(
      renderer &&
      renderer.windowId === context.windowId &&
      renderer.webContentsId === context.webContentsId &&
      renderer.rendererIncarnation === context.rendererIncarnation
    );
  }

  private pruneTombstones(now = Date.now()) {
    for (const [leaseId, expiresAt] of this.tombstones) {
      if (expiresAt <= now) this.tombstones.delete(leaseId);
    }
  }

  private workspaceAuthority(conversationId: string, failureStatus: 409 | 410) {
    const resolver = this.resolveEffectiveWorkspace;
    if (!resolver) {
      throw statusError(503, "App surface workspace authority 尚未配置");
    }
    const workspace = resolver({ kind: "conversation", conversationId });
    if (workspace.kind !== "ready") {
      throw statusError(failureStatus, workspace.message);
    }
    return workspace.authorityIdentity;
  }

  private surfaceGrant(input: Pick<
    AppSurfaceAcquireInput,
    "mode" | "conversationId" | "appId"
  >) {
    return input.mode === "studio"
      ? this.grants.studioSurfaceGrant(input.conversationId, input.appId)
      : this.grants.effectiveGrant(input.conversationId, input.appId);
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
  studioGrantRevision?: number;
  baseGuiDecisionRevision?: number;
}) {
  return [
    snapshot.chatGrantRevision,
    snapshot.projectId ?? "no-project",
    snapshot.projectGrantRevision ?? -1,
    snapshot.membershipRevision,
    snapshot.defaultGrantRevision,
    snapshot.studioGrantRevision ?? -1,
    snapshot.baseGuiDecisionRevision ?? -1,
  ].join(":");
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
