/**
 * [INPUT]: Depends on AppStore active static-v2/compiled-v3 generation, compiled-v3 artifact verification, BaseGuiGrantStore exact projection, AppGateway, trusted renderer identity, GUI token/scanning/API factories, and Node fs realpath
 * [OUTPUT]: Provides sealed-only active or staged Base GUI projection, cutover artifact/root/binding preflight, exact generation inspection, renderer-owned scoped tokens, surface registration, and origin worker/cache clearing on capability changes
 * [POS]: The apps module Base GUI capability owner; route, metadata, token, renderer ownership, and handler consume the same generation binding
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
import type { TrustedRendererContext } from "../window/surfaces/trusted-renderer-context";
import {
  createWorkspacePreviewHandler,
  type WorkspacePreviewPort,
} from "./base-gui/workspace-preview";
import { verifyCompiledV3Artifact } from "./gui-build/pipeline/seal";

/**
 * 详情页取 gui-info 与编辑 chat turn 落地共用
 * 同一条幂等投影——任何一条都能把新增/删除的 `gui/` 立即拉平，不存在
 * 「首启注册后就再不复查」的漂移窗口。
 */
export class AppGuiProjection {
  private readonly tokens = new GuiTokenRegistry();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly surfaces = new Map<string, Readonly<{
    input: AppGuiInfoInput;
    binding: BaseGuiLiveBinding;
    rendererKey: string | null;
  }>>();

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

  async prepareGeneration(appId: string, generationId: string) {
    const generation = this.store.get(appId)?.generations.find(
      (candidate) => candidate.generationId === generationId
    );
    if (
      generation?.contentLayoutVersion !== 3 ||
      !generation.manifestDigest ||
      !generation.sourcePackageDigest ||
      !generation.buildReceiptDigest
    ) throw new Error("GUI_CUTOVER_GENERATION_INVALID");
    await verifyCompiledV3Artifact(this.store.artifactRoot(appId, generationId), {
      manifestDigest: generation.manifestDigest,
      sourcePackageDigest: generation.sourcePackageDigest,
      contentDigest: generation.contentDigest,
      buildReceiptDigest: generation.buildReceiptDigest,
    });
    const [{ pages, root }, binding] = await Promise.all([
      this.inspectGeneration(appId, generationId),
      Promise.resolve(this.bindingForGeneration(appId, generationId)),
    ]);
    if (!root || pages.length === 0 || !binding) {
      throw new Error("GUI_CUTOVER_GENERATION_UNROUTABLE");
    }
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
  info(
    input: AppGuiInfoInput,
    options: { generationId?: string } = {},
    renderer?: TrustedRendererContext
  ): Promise<AppGuiInfo> {
    return this.serialize(`${input.appId}:${input.surfaceId}`, async () => {
      const { pages, contentRoot, root } = options.generationId
        ? await this.inspectGeneration(input.appId, options.generationId)
        : await this.inspect(input.appId);
      const binding = options.generationId
        ? this.bindingForGeneration(input, options.generationId)
        : this.liveBinding(input);
      const origin = this.gateway.getSurfaceOrigin(input.appId, input.surfaceId);
      if (pages.length && binding && root) {
        this.gateway.registerBaseGui(
          input.appId,
          input.surfaceId,
          join(contentRoot, "gui"),
          root,
          binding
        );
        this.surfaces.set(surfaceKey(input.appId, input.surfaceId), {
          input: structuredClone(input),
          binding: structuredClone(binding),
          rendererKey: renderer ? rendererKey(renderer) : null,
        });
        this.tokens.revokeSurface(input.appId, input.surfaceId);
        await this.gateway.clearSurfaceWorkerState(input.appId, input.surfaceId);
      } else {
        this.surfaces.delete(surfaceKey(input.appId, input.surfaceId));
        this.tokens.revokeSurface(input.appId, input.surfaceId);
        this.gateway.unregisterBaseGuiSurface(input.appId, input.surfaceId);
      }
      return {
        pages,
        origin,
        token: pages.length && binding ? this.tokens.mint(binding) : "",
        generationKey: binding
          ? `${binding.generationId}:${binding.contentDigest}`
          : "",
        bootstrapProtocol: this.bootstrapProtocol(input.appId, binding?.generationId),
        baseCapabilities: binding?.baseCapabilities ?? [],
        hostActions: binding?.hostActions ?? [],
        appSurfaceLeaseId: input.appSurfaceLeaseId,
      };
    });
  }

  private async inspectGeneration(appId: string, generationId: string) {
    const record = this.store.get(appId);
    const generation = record?.generations.find(
      (item) => item.generationId === generationId
    );
    if (record?.state !== "ready" || generation?.manifest.kind !== "base") {
      return { pages: [], contentRoot: "", root: "" };
    }
    const contentRoot = this.store.contentRoot(appId, generationId);
    const root = await this.canonicalGuiRoot(contentRoot);
    const pages = root ? await collectGuiPages(root) : [];
    return { pages, contentRoot, root: root ?? "" };
  }

  private bootstrapProtocol(appId: string, generationId?: string) {
    if (!generationId) return "load-v0" as const;
    const generation = this.store.get(appId)?.generations
      .find((candidate) => candidate.generationId === generationId);
    return generation?.contentLayoutVersion === 3
      ? "nonce-ready-v1" as const
      : "load-v0" as const;
  }

  liveBinding(input: AppGuiInfoInput | string): BaseGuiLiveBinding | null {
    const appId = typeof input === "string" ? input : input.appId;
    const record = this.store.get(appId);
    const active = record?.generationBinding.active;
    return active ? this.bindingForGeneration(input, active.generationId) : null;
  }

  private bindingForGeneration(
    input: AppGuiInfoInput | string,
    generationId: string
  ): BaseGuiLiveBinding | null {
    const appId = typeof input === "string" ? input : input.appId;
    const record = this.store.get(appId);
    const generation = record?.generations.find(
      (item) => item.generationId === generationId
    );
    if (
      !record ||
      !generation ||
      (generation.contentLayoutVersion !== 2 && generation.contentLayoutVersion !== 3) ||
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
      contentLayoutVersion: generation.contentLayoutVersion,
      generationId: generation.generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision:
        record.generationBinding.active?.generationId === generationId
          ? record.lifecycleRevision
          : record.lifecycleRevision + 1,
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

  registeredSurfaces(appId: string, generationId?: string) {
    return [...this.surfaces.values()]
      .filter(({ binding }) =>
        binding.appId === appId &&
        (!generationId || binding.generationId === generationId)
      )
      .map((value) => structuredClone(value));
  }

  artifactRoots() {
    return [...this.surfaces.values()].map(({ binding }) => ({
      appId: binding.appId,
      generationId: binding.generationId,
    }));
  }

  rendererOwns(input: AppGuiInfoInput, renderer: TrustedRendererContext) {
    const registered = this.surfaces.get(surfaceKey(input.appId, input.surfaceId));
    return registered?.input.appSurfaceLeaseId === input.appSurfaceLeaseId &&
      registered.rendererKey === rendererKey(renderer);
  }

  /** App 下线/删除排在在途签发之后，保证 revoke 是该队列的最终写。 */
  revoke(appId: string) {
    return this.serialize(appId, async () => {
      await this.revokeSurfacesNow(appId);
    });
  }

  release(input: AppGuiInfoInput) {
    return this.serialize(`${input.appId}:${input.surfaceId}`, async () => {
      this.surfaces.delete(surfaceKey(input.appId, input.surfaceId));
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
    for (const [key, { binding }] of this.surfaces) {
      if (binding.appId === appId) this.surfaces.delete(key);
    }
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

function surfaceKey(appId: string, surfaceId: string) {
  return `${appId}:${surfaceId}`;
}

function rendererKey(renderer: TrustedRendererContext) {
  return JSON.stringify([
    renderer.windowId, renderer.webContentsId, renderer.rendererIncarnation,
  ]);
}
