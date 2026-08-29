/**
 * [INPUT]: Depends on AppStore active generation, BaseGuiGrantStore exact projection, AppGateway, GUI token/scanning/API factories, and Node fs realpath
 * [OUTPUT]: Provides the serialized Base GUI live projection, rotating scoped tokens and clearing origin worker/cache state on capability changes
 * [POS]: The apps module Base GUI capability owner; route, metadata, token, and handler consume the same generation binding
 */

import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  requestedBaseGuiCapabilities,
  requestedBaseGuiHostActions,
  type AppGuiInfo,
  type AppGuiInfoInput,
  type BaseGuiLiveBinding,
} from "../../../shared/apps-ipc";
import type { AppGateway } from "./app-gateway";
import type { AppStore } from "./app-store";
import {
  collectGuiPages,
  createBaseGuiApi,
  GuiTokenRegistry,
  type GuiBasePort,
} from "./gui-api";
import { isContained } from "./support";
import type { BaseGuiGrantStore } from "./base-gui/grant-store";
import {
  createWorkspacePreviewHandler,
  type WorkspacePreviewPort,
} from "./base-gui/workspace-preview";

/**
 * 详情页取 gui-info 与编辑 chat turn 落地共用
 * 同一条幂等投影——任何一条都能把新增/删除的 `gui/` 立即拉平，不存在
 * 「首启注册后就再不复查」的漂移窗口。
 */
export class AppGuiProjection {
  private readonly tokens = new GuiTokenRegistry();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly store: AppStore,
    private readonly gateway: AppGateway,
    private readonly grants: BaseGuiGrantStore
  ) {}

  configureApi(port: GuiBasePort) {
    this.gateway.attachBaseGuiApi(createBaseGuiApi(this.tokens, port));
  }

  configureWorkspacePreview(port: WorkspacePreviewPort) {
    this.gateway.attachWorkspacePreview(
      createWorkspacePreviewHandler(this.tokens, port)
    );
  }

  sync(appId: string, options: { resetCapability?: boolean } = {}) {
    return this.serialize(appId, () => this.inspect(appId, options));
  }

  private async inspect(
    appId: string,
    options: { resetCapability?: boolean } = {}
  ) {
    const record = this.store.get(appId);
    const active = record?.generationBinding.active;
    if (record?.manifest?.kind === "base" && active) {
      const contentRoot = this.store.contentRoot(appId, active.generationId);
      const root = await this.canonicalGuiRoot(contentRoot);
      const pages = root ? await collectGuiPages(root) : [];
      if (root && pages.length) {
        if (options.resetCapability) await this.revokeSurfacesNow(appId);
        return { pages, contentRoot, root };
      }
    }
    await this.revokeSurfacesNow(appId);
    return { pages: [], contentRoot: "", root: "" };
  }

  /** 打开即轮换本 surface token；同 App 的其它面不受影响。 */
  info(input: AppGuiInfoInput): Promise<AppGuiInfo> {
    return this.serialize(`${input.appId}:${input.surfaceId}`, async () => {
      const { pages, contentRoot, root } = await this.inspect(input.appId);
      const binding = this.liveBinding(input);
      const origin = this.gateway.getSurfaceOrigin(input.appId, input.surfaceId);
      if (pages.length && binding && root) {
        this.gateway.registerBaseGui(
          input.appId,
          input.surfaceId,
          join(contentRoot, "gui"),
          root,
          binding
        );
        this.tokens.revokeSurface(input.appId, input.surfaceId);
        await this.gateway.clearSurfaceWorkerState(input.appId, input.surfaceId);
      } else {
        this.tokens.revokeSurface(input.appId, input.surfaceId);
        this.gateway.unregisterBaseGuiSurface(input.appId, input.surfaceId);
      }
      return {
        pages,
        origin,
        token: pages.length && binding ? this.tokens.mint(binding) : "",
        baseCapabilities: binding?.baseCapabilities ?? [],
        hostActions: binding?.hostActions ?? [],
      };
    });
  }

  liveBinding(input: AppGuiInfoInput | string): BaseGuiLiveBinding | null {
    const appId = typeof input === "string" ? input : input.appId;
    const record = this.store.get(appId);
    const active = record?.generationBinding.active;
    const generation = record?.generations.find(
      (item) => item.generationId === active?.generationId
    );
    if (
      !record ||
      !active ||
      !generation ||
      generation.contentLayoutVersion !== 2 ||
      !generation.manifestDigest ||
      !generation.sourcePackageDigest ||
      generation.manifest.kind !== "base"
    ) {
      return null;
    }
    const requested = requestedBaseGuiCapabilities(generation.manifest);
    const projection = this.grants.projection(appId, generation.generationId);
    const approved =
      projection.decision?.contentDigest === generation.contentDigest &&
      projection.decision.state === "approved";
    const baseCapabilities = approved
      ? requested.filter((capability) => projection.capabilities.includes(capability))
      : [];
    const hostActions = approved
      ? requestedBaseGuiHostActions(generation.manifest).filter((action) =>
          projection.hostActions.includes(action)
        )
      : [];
    return {
      appId,
      generationId: generation.generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision: record.lifecycleRevision,
      baseCapabilities,
      hostActions,
      workspaceReadScope: baseCapabilities.includes("workspace-read") &&
        projection.capabilityScopes.workspaceRead === "design/"
        ? "design/"
        : null,
      surfaceId: typeof input === "string" ? "capability-projection" : input.surfaceId,
      appSurfaceLeaseId: typeof input === "string" ? null : input.appSurfaceLeaseId,
      capabilityDecisionId: approved
        ? projection.decision!.decisionId
        : null,
      capabilityRevision: projection.revision,
    };
  }

  /** App 下线/删除排在在途签发之后，保证 revoke 是该队列的最终写。 */
  revoke(appId: string) {
    return this.serialize(appId, async () => {
      await this.revokeSurfacesNow(appId);
    });
  }

  release(input: AppGuiInfoInput) {
    return this.serialize(`${input.appId}:${input.surfaceId}`, async () => {
      this.tokens.revokeSurface(input.appId, input.surfaceId);
      const registered = this.gateway.isBaseGuiRegistered(
        input.appId,
        input.surfaceId
      );
      this.gateway.unregisterBaseGuiSurface(input.appId, input.surfaceId);
      if (registered) {
        await this.gateway.clearSurfaceWorkerState(input.appId, input.surfaceId);
      }
    });
  }

  private async revokeSurfacesNow(appId: string) {
    this.tokens.revokeApp(appId);
    const origins = this.gateway.unregisterBaseGuiApp(appId);
    await Promise.all(
      origins.map(({ surfaceId }) =>
        this.gateway.clearSurfaceWorkerState(appId, surfaceId)
      )
    );
  }

  /** mint 是撤销式写操作；同 App 并发 info 必须按调用顺序完成。 */
  private serialize<T>(appId: string, operation: () => Promise<T>) {
    const previous = this.tails.get(appId) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(operation);
    const settled = running.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(appId, settled);
    void settled.then(() => {
      if (this.tails.get(appId) === settled) this.tails.delete(appId);
    });
    return running;
  }

  /** symlink 根在注册时点就拒绝，不把逃逸留给逐请求 containment 兜底。 */
  private async canonicalGuiRoot(dir: string) {
    try {
      const [dirReal, guiReal] = await Promise.all([
        realpath(dir),
        realpath(join(dir, "gui")),
      ]);
      if (!isContained(dirReal, guiReal) || dirReal === guiReal) return null;
      return (await stat(guiReal)).isDirectory() ? guiReal : null;
    } catch {
      return null;
    }
  }
}
