/**
 * [INPUT]: Depends on App store/runtime/delete services, Base GUI projection, gateway request barriers, generation-fenced side effects, and extension integration
 * [OUTPUT]: Provides the live origin lookup, no-pre-revoke GUI cutover with request/effect drain, symmetric Studio authorize/decline, extension grant revocation, and destructive App lifecycle operations
 * [POS]: apps/service operation layer; removes transactional mechanics from the AppsService composition root
 */

import { randomUUID } from "node:crypto";
import type { AppRecord, RemoveAppMode } from "../../../../../shared/apps-ipc";
import { asError } from "../../../errors";
import type { AppExtensionIntegration } from "../../../extensions/integration/app-extension-composition";
import type { AppDeleteService } from "../../conversion/app-delete";
import { shouldMarkDeleteFailed } from "../../conversion/app-delete";
import type { AppGateway } from "../../gateway/app-gateway";
import type { AppRuntime } from "../../server/app-runtime";
import type { AppStore } from "../../store/app-store";
import type { AppGuiProjection } from "../../generation/gui-projection";
import type { MaintenanceGate } from "../../maintenance/maintenance-gate";

type GuiCutoverPorts = Readonly<{
  runExclusive<T>(appId: string, operation: () => Promise<T>): Promise<T>;
  gateway: AppGateway;
  gui: AppGuiProjection;
  activeGenerationId(appId: string): string | null;
  closeSideEffects(appId: string): void;
  drainSideEffects(appId: string, generationId: string, deadlineMs: number): Promise<void>;
  reopenSideEffects(appId: string): void;
}>;

type GenerationCutoverPorts = Readonly<{
  hasRecord(appId: string): boolean;
  runLifecycle<T>(appId: string, operation: () => Promise<T>): Promise<T>;
  runGui<T>(appId: string, operation: () => Promise<T>): Promise<T>;
}>;

/** A not-yet-published App cannot own a surface, so its first generation only needs the
 * residence-shared lifecycle lane. Existing Apps additionally drain GUI capability. */
export function withGenerationCutover<T>(
  ports: GenerationCutoverPorts,
  appId: string,
  operation: () => Promise<T>
) {
  return ports.runLifecycle(appId, () =>
    ports.hasRecord(appId) ? ports.runGui(appId, operation) : operation()
  );
}

export function withGuiCutover<T>(
  ports: GuiCutoverPorts,
  appId: string,
  operation: () => Promise<T>
) {
  return ports.runExclusive(appId, async () => {
    /* The old route remains visible while the caller finishes fallible work.
       Admission closes only for the short CAS barrier; revocation happens after the
       new active generation is durable. Failure leaves the previous surface intact. */
    const previousGenerationId = ports.activeGenerationId(appId);
    ports.gateway.requestLeases.closeAdmission(appId);
    ports.closeSideEffects(appId);
    try {
      const deadline = Date.now() + 30_000;
      const generationId = ports.activeGenerationId(appId);
      while (ports.gateway.requestLeases.countApp(appId) > 0) {
        if (Date.now() >= deadline) {
          throw Object.assign(new Error("APP_GUI_DRAIN_TIMEOUT"), { status: 409 });
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (generationId) await ports.drainSideEffects(appId, generationId, deadline);
      const result = await operation();
      const nextGenerationId = ports.activeGenerationId(appId);
      /* A generation swap keeps old surface routes/tokens alive under the durable
         draining id until renderer nonce-ready releases them. Same-generation
         revocation must still invalidate every token immediately. */
      await ports.gui.sync(appId, {
        resetCapability: previousGenerationId === nextGenerationId,
      });
      return result;
    } finally {
      ports.gateway.requestLeases.reopenAdmission(appId);
      ports.reopenSideEffects(appId);
    }
  });
}

/* ============================================================
 * 拒绝是授权的对称面，不是「不点同意」
 *
 * 同意有一条端到端的路（consent → grant → promote），拒绝从前只存在于
 * main 的账本里，界面上没有入口——用户唯一能做的是把窗口关掉，而那什么
 * 也没发生：pending 代还在，重新构建被它挡着，下次进来还是同一张卡。
 *
 * 这里把拒绝收成一条命令：有 Base GUI decision 就走账本的 declined 语义
 * （落拒绝墓碑并丢弃这一代），没有就直接 abort 这一代。两条路的终点相同
 * ——pending 消失，重新构建重新可用。没有 pending 时它是幂等的 no-op：
 * 「没有待批的东西可拒绝」本就不是错误，用户只是还没被授权而已。
 * ============================================================ */
export async function declineStudioAccess(input: {
  appId: string;
  store: AppStore;
}) {
  const record = requireRecord(input.store, input.appId);
  const pending = record.generationBinding.pending;
  if (!pending) return record;
  if (pending.baseGuiDecision?.state === "consent-required") {
    return input.store.resolvePendingBaseGuiConsent(input.appId, [], [], {});
  }
  return input.store.abortPendingGeneration(input.appId, pending.generationId);
}

export function authorizeStudioAccess(input: {
  appId: string;
  store: AppStore;
  cutover<T>(operation: () => Promise<T>): Promise<T>;
}) {
  const prepare = async () => {
    let record = requireRecord(input.store, input.appId);
    let pending = record.generationBinding.pending;
    const generationId =
      pending?.generationId ?? record.generationBinding.active?.generationId;
    const generation = record.generations.find(
      (item) => item.generationId === generationId
    );
    if (
      !generationId ||
      !generation ||
      generation.manifest.kind !== "base" ||
      !generation.manifest.gui
    ) {
      throw new Error("App 没有可授权的 Studio GUI");
    }
    if (
      pending &&
      generation.extensionRequirementResolution.kind === "frozen" &&
      pending.extensionState !== "ready-to-promote"
    ) {
      record = await input.store.resolvePendingConsent(input.appId, true);
      pending = record.generationBinding.pending;
    }
    if (pending?.baseGuiDecision?.state === "consent-required") {
      record = await input.store.resolvePendingBaseGuiConsent(
        input.appId,
        pending.baseGuiDecision.requestedCapabilities,
        pending.baseGuiDecision.requestedHostActions,
        pending.baseGuiDecision.requestedCapabilityScopes
      );
      pending = record.generationBinding.pending;
    }
    if (!pending) {
      return input.cutover(() =>
        input.store.grantStudioAccess(input.appId, generationId)
      );
    }
    record = await input.store.grantStudioAccess(input.appId, generationId);
    pending = record.generationBinding.pending;
    return pending
      ? input.store.promotePendingGeneration(
          input.appId,
          pending.expectedConsentRevision
        )
      : record;
  };
  return prepare();
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
  markDeleteStalled(message: string): Promise<void>;
}) {
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
  } catch (cause) {
    const stalled = (await input.deleteService.residual(input.appId)) !== null;
    if (shouldMarkDeleteFailed({
      state: input.store.get(input.appId)?.state,
      hasResidual: stalled,
      rejectionCode: (cause as { code?: unknown } | null)?.code,
    })) {
      await input.markDeleteStalled(asError(cause).message);
    }
    throw cause;
  }
}

function requireRecord(store: AppStore, appId: string): AppRecord {
  const record = store.get(appId);
  if (!record) throw new Error("App 不存在");
  return record;
}
