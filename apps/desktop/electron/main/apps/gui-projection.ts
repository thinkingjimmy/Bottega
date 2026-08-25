/**
 * [INPUT]: Depends on AppStore active generation, BaseGuiGrantStore exact projection, AppGateway, gui-api token/scanning/endpoint factory and Node fs realpath
 * [OUTPUT]: Provides AppGuiProjection with the only live binding, serial projection request `gui/`Remove the old worker, change the scoped token and generate GuiInfo
 * [POS]: The app module is based on the base-gui live capability ownerThe route/meta/token/handler uses the same binding
 */

import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  requestedBaseGuiCapabilities,
  type AppGuiInfo,
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

  sync(appId: string, options: { resetCapability?: boolean } = {}) {
    return this.serialize(appId, () => this.syncNow(appId, options));
  }

  private async syncNow(
    appId: string,
    options: { resetCapability?: boolean } = {}
  ) {
    const record = this.store.get(appId);
    const origin = this.gateway.getOrigin(appId);
    const active = record?.generationBinding.active;
    if (record?.manifest?.kind === "base" && active) {
      const binding = this.liveBinding(appId);
      const contentRoot = this.store.contentRoot(appId, active.generationId);
      const root = binding ? await this.canonicalGuiRoot(contentRoot) : null;
      const pages = root ? await collectGuiPages(root) : [];
      if (binding && root && pages.length) {
        this.gateway.registerBaseGui(appId, join(contentRoot, "gui"), root, {
          ...binding,
        });
        if (options.resetCapability) {
          this.tokens.revoke(appId);
          await this.gateway.clearBaseGuiWorkerState(appId);
        }
        return { pages, origin, binding };
      }
    }
    const registered = this.gateway.isBaseGuiRegistered(appId);
    if (registered) this.gateway.unregister(appId);
    this.tokens.revoke(appId);
    if (registered || options.resetCapability) {
      await this.gateway.clearBaseGuiWorkerState(appId);
    }
    return { pages: [], origin, binding: null };
  }

  /** 打开即轮换 token：旧 iframe 的下一次请求必然 401。 */
  info(appId: string): Promise<AppGuiInfo> {
    return this.serialize(appId, async () => {
      const { pages, origin, binding } = await this.syncNow(appId, {
        resetCapability: true,
      });
      return {
        pages,
        origin,
        token: pages.length && binding ? this.tokens.mint(binding) : "",
        baseCapabilities: binding?.baseCapabilities ?? [],
      };
    });
  }

  liveBinding(appId: string): BaseGuiLiveBinding | null {
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
    return {
      appId,
      generationId: generation.generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision: record.lifecycleRevision,
      baseCapabilities,
      capabilityDecisionId: approved
        ? projection.decision!.decisionId
        : null,
      capabilityRevision: projection.revision,
    };
  }

  /** 编辑/校验侧现场扫盘，绝不读可能过期的缓存。 */
  async pagesForApp(appId: string) {
    const { pages } = await this.sync(appId);
    return pages;
  }

  /** App 下线/删除排在在途签发之后，保证 revoke 是该队列的最终写。 */
  revoke(appId: string) {
    return this.serialize(appId, async () => {
      this.tokens.revoke(appId);
      const registered = this.gateway.isBaseGuiRegistered(appId);
      if (registered) this.gateway.unregister(appId);
      if (registered || this.store.get(appId)?.manifest?.kind === "base") {
        await this.gateway.clearBaseGuiWorkerState(appId);
      }
    });
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
