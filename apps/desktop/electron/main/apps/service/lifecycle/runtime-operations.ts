/**
 * [INPUT]: Depends on App store/runtime/delete services, Base GUI projection/grants/gateway, extension integration, and Design custody
 * [OUTPUT]: Provides focused runtime status, GUI cutover, grant revocation, and destructive App lifecycle operations
 * [POS]: apps/service operation layer; removes transactional mechanics from the AppsService composition root
 */

import { randomUUID } from "node:crypto";
import type { AppRuntimeStatus, AppRecord, RemoveAppMode } from "../../../../../shared/apps-ipc";
import { asError } from "../../../errors";
import type { AppExtensionIntegration } from "../../../extensions/integration/app-extension-composition";
import type { DesignService } from "../../../design/service";
import { DESIGN_PRESET_ID } from "../../../design/enabled";
import type { AppDeleteService } from "../../app-delete";
import { shouldMarkDeleteFailed } from "../../app-delete";
import type { AppGateway } from "../../app-gateway";
import type { AppRuntime } from "../../app-runtime";
import type { AppStore } from "../../app-store";
import type { BaseGuiGrantStore } from "../../base-gui/grant-store";
import type { AppGuiProjection } from "../../gui-projection";
import type { MaintenanceGate } from "../../maintenance-gate";

type GuiCutoverPorts = Readonly<{
  runExclusive<T>(appId: string, operation: () => Promise<T>): Promise<T>;
  gateway: AppGateway;
  gui: AppGuiProjection;
}>;

export function withGuiCutover<T>(
  ports: GuiCutoverPorts,
  appId: string,
  operation: () => Promise<T>
) {
  return ports.runExclusive(appId, async () => {
    ports.gateway.requestLeases.closeAdmission(appId);
    try {
      await ports.gui.revoke(appId);
      const deadline = Date.now() + 30_000;
      while (ports.gateway.requestLeases.countApp(appId) > 0) {
        if (Date.now() >= deadline) {
          throw Object.assign(new Error("APP_GUI_DRAIN_TIMEOUT"), { status: 409 });
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const result = await operation();
      await ports.gui.sync(appId, { resetCapability: true });
      return result;
    } catch (cause) {
      await ports.gui.sync(appId, { resetCapability: true }).catch(() => {});
      throw cause;
    } finally {
      ports.gateway.requestLeases.reopenAdmission(appId);
    }
  });
}

export function revokeBaseGuiAccess(input: {
  appId: string;
  store: AppStore;
  grants: BaseGuiGrantStore;
  cutover<T>(operation: () => Promise<T>): Promise<T>;
}) {
  const record = requireRecord(input.store, input.appId);
  const generationId = record.generationBinding.active?.generationId;
  const generation = record.generations.find((item) => item.generationId === generationId);
  if (!generationId || generation?.manifest.kind !== "base") {
    throw new Error("App 没有 active Base GUI generation");
  }
  return input.cutover(async () => {
    await input.grants.revoke(input.appId, generationId);
    return input.store.advanceLifecycle(input.appId);
  });
}

export async function revokeExtensionGrant(
  store: AppStore,
  extensions: AppExtensionIntegration | null,
  appId: string
) {
  const generationId = requireRecord(store, appId).generationBinding.active?.generationId;
  if (!generationId || !extensions) {
    throw new Error("App 没有 active extension generation");
  }
  await extensions.grants.revoke(appId, generationId);
}

export async function rebuildExtensionGeneration(store: AppStore, appId: string) {
  return store.migrateGeneration(appId, randomUUID());
}

export function runtimeStatus(
  store: AppStore,
  runtime: AppRuntime,
  appId: string
): AppRuntimeStatus {
  const record = requireRecord(store, appId);
  const generationId = record.generationBinding.active?.generationId ?? null;
  const generation = record.generations.find((item) => item.generationId === generationId);
  const running = runtime.isRunning(appId);
  return {
    appId,
    state: record.state,
    lifecycleRevision: record.lifecycleRevision,
    generationId,
    contentDigest: generation?.contentDigest ?? null,
    runtime: running ? "running" : record.lastError?.phase === "start" ? "crashed" : "stopped",
    activationId: running && generationId ? `activation:${appId}:${generationId}` : null,
    origin: running ? runtime.getOrigin(appId) : null,
    quarantined: record.state === "quarantined",
  };
}

export function originWithoutStart(store: AppStore, runtime: AppRuntime, appId: string) {
  if (!runtime.isRunning(appId)) return null;
  const generationId = requireRecord(store, appId).generationBinding.active?.generationId;
  return {
    origin: runtime.getOrigin(appId),
    ...(generationId
      ? { generationId, activationId: `activation:${appId}:${generationId}` }
      : {}),
  };
}

export async function removeApp(input: {
  appId: string;
  mode?: RemoveAppMode;
  requestId: string;
  store: AppStore;
  maintenanceGate: MaintenanceGate;
  deleteService: AppDeleteService | null;
  design: DesignService;
  invalidateSkills(): void;
  markDeleteStalled(message: string): Promise<void>;
}) {
  const designApp = input.store.get(input.appId)?.presetId === DESIGN_PRESET_ID;
  if (input.maintenanceGate.isLocked(input.appId)) {
    throw new Error("App 修复中，暂时不能删除");
  }
  requireRecord(input.store, input.appId);
  if (!input.deleteService) throw new Error("App delete 尚未初始化");
  if (!input.mode || !input.requestId) throw new Error("App 删除参数不完整");
  try {
    await input.deleteService.remove({
      appId: input.appId,
      mode: input.mode,
      requestId: input.requestId,
    });
    if (designApp) {
      /* markFactoryDeleted 是持久「已删」墓碑,必须等 remove() 真正提交后才落。
         若抢在 remove 之前落账,remove 抛错(如 drain 冲突 409)时 App 仍
         ready+granted、$design 继续可见,而账本已宣告删除 → ensure() 永远早退,
         durable 谎言换来死锁。 */
      await input.design.markFactoryDeleted(input.appId);
      await input.design.orphanApp(input.appId);
      input.invalidateSkills();
    }
  } catch (cause) {
    const status = (cause as { status?: number }).status;
    const stalled =
      status === 409 && (await input.deleteService.residual(input.appId)) !== null;
    if (shouldMarkDeleteFailed({
      status,
      state: input.store.get(input.appId)?.state,
      hasResidual: stalled,
    })) {
      await input.markDeleteStalled(
        stalled
          ? "上一次删除中断后未收尾，用「重试删除残留」续跑同一事务"
          : asError(cause).message
      );
    }
    throw cause;
  }
}

function requireRecord(store: AppStore, appId: string): AppRecord {
  const record = store.get(appId);
  if (!record) throw new Error("App 不存在");
  return record;
}
