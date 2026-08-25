/**
 * [INPUT]: Depends on rendererIpc, Apps shared channels/input assertions and store/runtime/grant/package operating port inserted with AppsService
 * [OUTPUT]: RegistersIPC, full registered Apps renderer IPC and package flow IPC are available for the in-house
 * [POS]: The transmission adapter for apps/services; Only particle analysis and division, no domain status
 */

import { join } from "node:path";
import { shell, type BrowserWindow } from "electron";
import { customAlphabet } from "nanoid";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  APPS_CHANNEL,
  repairSite,
  type AppCapabilitiesSnapshot,
  type AppExtensionStatus,
  type AppGuiInfo,
  type AppInstallEvent,
  type AppRecord,
  type AppRuntimeStatus,
  type AppsListSnapshot,
  type EnsureAppChatSlotInput,
  type RemoveAppMode,
  type RenameAppInput,
  type SaveAsAppResult,
  type SetAppAgentInput,
} from "../../../../shared/apps-ipc";
import { rendererIpc } from "../../ipc-registrar";
import { rendererIdentity } from "../../window/renderer-identity";
import type { AppDeleteService } from "../app-delete";
import type { AppInstaller } from "../app-installer";
import type { AppRuntime } from "../app-runtime";
import type { AppStore } from "../app-store";
import type { AppGrantAuthority } from "../attachments/grant-authority";
import {
  assertAppGrantTarget,
  assertAppSurfaceAcquireInput,
  assertAvailableAppsInput,
  assertSetAppGrantInput,
  assertSetAppGrantStateInput,
  assertSetDefaultAppGrantInput,
  assertSurfaceLeaseId,
} from "../attachments/grant-inputs";
import type { AppManagementLeaseRegistry } from "../attachments/management-leases";
import type { AppAttachmentSurfaceLeaseRegistry } from "../attachments/surface-leases";
import { SaveAsAppRejectedError, type SaveAsAppService } from "../save-as-app";
import {
  assertAppId,
  assertChatSlotInput,
  assertRemoveMode,
  assertRenameInput,
  assertSaveAsAppInput,
  assertSetAgentInput,
} from "../service-inputs";
import type { AppPackageController } from "../share/app-package-controller";
import {
  assertAddAppInput,
  createInstallingAppRecord,
  normalizeGithubRepoUrl,
} from "../support";
import type { AppLifecycleAdmissionGate } from "../../lifecycle/app-platform-admission";

type AppsIpcDependencies = {
  store: AppStore;
  runtime: AppRuntime;
  installer: AppInstaller;
  packages: AppPackageController;
  lifecycleGate: AppLifecycleAdmissionGate;
  gatewayWarning(): string | null;
  grantAuthority(): AppGrantAuthority;
  surfaceLeases(): AppAttachmentSurfaceLeaseRegistry;
  managementLeases(): AppManagementLeaseRegistry;
  saveAsApp(): SaveAsAppService | null;
  appDelete(): AppDeleteService | null;
  emit(event: AppInstallEvent): void;
  requireRecord(appId: string): AppRecord;
  stop(appId: string): Promise<void>;
  runtimeStatus(appId: string): AppRuntimeStatus;
  originWithoutStart(appId: string): {
    origin: string;
    generationId?: string;
    activationId?: string;
  } | null;
  extensionStatus(appId: string): AppExtensionStatus;
  capabilities(appId: string): Promise<AppCapabilitiesSnapshot>;
  resolveExtensionConsent(appId: string, granted: boolean): Promise<AppRecord>;
  resolveBaseGuiConsent(
    appId: string,
    grantedCapabilities: import("../../../../shared/apps-ipc").BaseGuiCapability[]
  ): Promise<AppRecord>;
  revokeBaseGuiAccess(appId: string): Promise<AppRecord>;
  revokeExtensionGrant(appId: string): Promise<AppExtensionStatus>;
  promoteGeneration(appId: string, expectedConsentRevision: number): Promise<AppRecord>;
  rebuildExtensionGeneration(appId: string): Promise<AppRecord>;
  remove(appId: string, mode?: RemoveAppMode, requestId?: string): Promise<void>;
  readLogTail(appId: string): Promise<string>;
  setAgent(input: SetAppAgentInput): Promise<AppRecord>;
  rename(input: RenameAppInput): Promise<AppRecord>;
  ensureChatSlot(input: EnsureAppChatSlotInput): unknown;
  guiInfo(appId: string): Promise<AppGuiInfo>;
  resolveMaintenanceBackend(requested: AgentBackendId | "auto"): Promise<{
    id: AgentBackendId;
    version?: string;
  }>;
  resolvePresetAgent(): Promise<AgentBackendId>;
  onClosed(): void;
};

const createAppId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyz0123456789",
  10
);

export function registerAppsIpc(
  window: BrowserWindow,
  rendererUrl: string,
  deps: AppsIpcDependencies
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Apps 请求")
    .handle(
      APPS_CHANNEL.list,
      () =>
        ({
          apps: deps.store.list(),
          runtimeWarning: deps.gatewayWarning(),
        }) satisfies AppsListSnapshot
    )
    .handle(APPS_CHANNEL.add, async (value) => {
      const input = assertAddAppInput(value);
      const normalized = normalizeGithubRepoUrl(input.repoUrl);
      const duplicate = deps.store
        .list()
        .find((record) => record.sourceRepoUrl === normalized.repoUrl);
      if (duplicate) throw new Error(`该仓库已添加：${duplicate.id}`);
      if (input.preflightId || input.confirmedDigest) {
        if (!input.preflightId || !input.confirmedDigest) {
          throw new Error("Base App preflight 参数不完整");
        }
        const maintenance = await deps.resolveMaintenanceBackend(
          input.maintenanceAgent
        );
        return deps.packages.importBase({
          request: input,
          repoUrl: normalized.repoUrl,
          agent: maintenance.id,
        });
      }
      const maintenance = await deps.resolveMaintenanceBackend(
        input.maintenanceAgent
      );
      let id = createAppId();
      while (deps.store.hasRetiredId(id)) id = createAppId();
      await deps.store.reserveId(id);
      const record = createInstallingAppRecord({
        id,
        dir: join(deps.store.appsRoot, id),
        repoUrl: normalized.repoUrl,
        displayName: normalized.displayName,
        maintenance: {
          id: maintenance.id,
          ...(maintenance.version ? { version: maintenance.version } : {}),
        },
        addedAt: Date.now(),
      });
      const saved = await deps.store.set(record);
      deps.emit({ appId: id, type: "status", record: saved });
      deps.installer.enqueue(id);
      return saved;
    })
    .handle(APPS_CHANNEL.open, async (rawId) => {
      const appId = assertAppId(rawId);
      const result = await deps.lifecycleGate.run(appId, () => {
        const record = deps.requireRecord(appId);
        if (!deps.lifecycleGate.isOpen(appId) || record.state !== "ready") {
          throw Object.assign(new Error("App lifecycle admission 已关闭"), {
            status: 409,
          });
        }
        return deps.runtime.ensureRunning(appId);
      });
      const generationId =
        deps.requireRecord(appId).generationBinding.active?.generationId;
      return {
        ...result,
        ...(generationId
          ? {
              generationId,
              activationId: `activation:${appId}:${generationId}`,
            }
          : {}),
      };
    })
    .handle(APPS_CHANNEL.status, (rawId) =>
      deps.runtimeStatus(assertAppId(rawId))
    )
    .handle(APPS_CHANNEL.originWithoutStart, (rawId) =>
      deps.originWithoutStart(assertAppId(rawId))
    )
    .handle(APPS_CHANNEL.stop, (rawId) => deps.stop(assertAppId(rawId)))
    .handle(APPS_CHANNEL.grant, (input) =>
      deps.grantAuthority().grant(assertSetAppGrantInput(input))
    )
    .handle(APPS_CHANNEL.revokeGrant, (target, rawId) =>
      deps
        .grantAuthority()
        .revoke(assertAppGrantTarget(target), assertAppId(rawId))
    )
    .handle(APPS_CHANNEL.setGrantState, (input) =>
      deps.grantAuthority().setState(assertSetAppGrantStateInput(input))
    )
    .handle(APPS_CHANNEL.setDefaultGrant, async (input) => {
      const saved = await deps
        .grantAuthority()
        .setDefaultGrant(assertSetDefaultAppGrantInput(input));
      deps.emit({ appId: saved.id, type: "status", record: saved });
      return saved;
    })
    .handle(APPS_CHANNEL.listGrantSources, () =>
      deps.grantAuthority().listSources()
    )
    .handle(APPS_CHANNEL.extensionStatus, (rawId) =>
      deps.extensionStatus(assertAppId(rawId))
    )
    .handle(APPS_CHANNEL.revokeExtensionGrant, async (rawId) => {
      const appId = assertAppId(rawId);
      return deps.revokeExtensionGrant(appId);
    })
    .handle(APPS_CHANNEL.rebuildExtensionGeneration, (rawId) =>
      deps.rebuildExtensionGeneration(assertAppId(rawId))
    )
    .handle(APPS_CHANNEL.capabilities, (rawId) =>
      deps.capabilities(assertAppId(rawId))
    )
    .handle(APPS_CHANNEL.listAvailable, (input) =>
      deps.grantAuthority().listAvailable(assertAvailableAppsInput(input))
    )
    .handle(APPS_CHANNEL.acquireSurface, (input) =>
      deps.surfaceLeases().acquire(assertAppSurfaceAcquireInput(input))
    )
    .handle(APPS_CHANNEL.releaseSurface, (leaseId) =>
      deps.surfaceLeases().release(assertSurfaceLeaseId(leaseId))
    )
    .handle(APPS_CHANNEL.acquireManagementLease, (rawId) => ({
      managementLeaseId: deps.managementLeases().issue({
        appId: assertAppId(rawId),
        ...rendererIdentity(window.webContents.id),
      }).managementLeaseId,
    }))
    .handle(APPS_CHANNEL.releaseManagementLease, (leaseId) =>
      deps.managementLeases().release(assertSurfaceLeaseId(leaseId))
    )
    .handle(APPS_CHANNEL.resolveExtensionConsent, async (raw) => {
      const input = assertExtensionConsentInput(raw);
      const saved = await deps.resolveExtensionConsent(
        input.appId,
        input.granted
      );
      deps.emit({ appId: saved.id, type: "status", record: saved });
      return saved;
    })
    .handle(APPS_CHANNEL.resolveBaseGuiConsent, async (raw) => {
      const input = assertBaseGuiConsentInput(raw);
      const saved = await deps.resolveBaseGuiConsent(
        input.appId,
        input.grantedCapabilities
      );
      deps.emit({ appId: saved.id, type: "status", record: saved });
      return saved;
    })
    .handle(APPS_CHANNEL.revokeBaseGuiAccess, async (rawId) => {
      const appId = assertAppId(rawId);
      const saved = await deps.revokeBaseGuiAccess(appId);
      deps.emit({ appId: saved.id, type: "status", record: saved });
      deps.emit({ appId: saved.id, type: "gui" });
      return saved;
    })
    .handle(APPS_CHANNEL.promoteGeneration, async (raw) => {
      const input = assertPromoteInput(raw);
      const saved = await deps.promoteGeneration(
        input.appId,
        input.expectedConsentRevision
      );
      deps.emit({ appId: saved.id, type: "status", record: saved });
      return saved;
    })
    .handle(APPS_CHANNEL.retry, async (rawId) => {
      const appId = assertAppId(rawId);
      const record = deps.requireRecord(appId);
      if (await deps.packages.hasPendingImport(appId)) {
        await deps.packages.retryPendingImport(appId);
      } else if (record.state === "install-failed") {
        await deps.installer.retryInstall(appId);
      } else if (record.state === "update-failed") {
        await deps.installer.retryUpdate(appId);
      } else if (record.state === "delete-failed") {
        const service = deps.appDelete();
        if (!service) throw new Error("App 删除尚未初始化");
        await service.retry(appId);
      } else {
        throw new Error("当前状态不能重试");
      }
    })
    .handle(APPS_CHANNEL.repair, async (rawId) => {
      const record = deps.requireRecord(assertAppId(rawId));
      if (!repairSite(record)) {
        throw new Error("当前失败阶段不能使用 Agent 修复");
      }
      await deps.installer.enqueueRepair(record.id);
    })
    .handle(APPS_CHANNEL.cancelInstall, async (rawId) => {
      const appId = assertAppId(rawId);
      if (await deps.packages.cancelPendingImport(appId)) {
        deps.emit({ appId, type: "removed" });
        return;
      }
      await deps.installer.cancel(appId);
    })
    .handle(APPS_CHANNEL.reveal, async (rawId) => {
      await shell.showItemInFolder(deps.requireRecord(assertAppId(rawId)).dir);
    })
    .handle(APPS_CHANNEL.readLog, (rawId) =>
      deps.readLogTail(assertAppId(rawId))
    )
    .handle(APPS_CHANNEL.setAgent, (value) =>
      deps.setAgent(assertSetAgentInput(value))
    )
    .handle(APPS_CHANNEL.saveAsApp, async (value) => {
      const service = deps.saveAsApp();
      if (!service) throw new Error("Save as App 尚未初始化");
      try {
        const record = await service.saveAsApp(assertSaveAsAppInput(value));
        return { status: "done", record } satisfies SaveAsAppResult;
      } catch (cause) {
        if (cause instanceof SaveAsAppRejectedError) {
          return {
            status: "rejected",
            error: { code: cause.code, message: cause.message },
          } satisfies SaveAsAppResult;
        }
        throw cause;
      }
    })
    .handle(APPS_CHANNEL.rename, (value) =>
      deps.rename(assertRenameInput(value))
    )
    .handle(APPS_CHANNEL.ensureChatSlot, (value) =>
      deps.ensureChatSlot(assertChatSlotInput(value))
    )
    .handle(APPS_CHANNEL.retrySkill, (rawId) => {
      const service = deps.saveAsApp();
      if (!service) throw new Error("Save as App 尚未初始化");
      return service.retrySkill(assertAppId(rawId));
    })
    .handle(APPS_CHANNEL.guiInfo, (rawId) => {
      const appId = assertAppId(rawId);
      if (deps.requireRecord(appId).manifest?.kind !== "base") {
        throw new Error("GUI 信息只对 Base App 提供");
      }
      return deps.guiInfo(appId);
    })
    .handle(APPS_CHANNEL.remove, (rawId, rawMode, rawRequestId) =>
      deps.remove(
        assertAppId(rawId),
        assertRemoveMode(rawMode),
        typeof rawRequestId === "string" ? rawRequestId : ""
      )
    );

  deps.packages.register(
    rendererIpc(window, rendererUrl, "拒绝非主窗口的 Apps 请求"),
    {
      assertAppId,
      requireRecord: deps.requireRecord,
      normalizeRepo: normalizeGithubRepoUrl,
      resolvePresetAgent: deps.resolvePresetAgent,
    }
  );
  window.once("closed", deps.onClosed);
}

function assertExtensionConsentInput(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("扩展同意参数无效");
  }
  const input = raw as { appId?: unknown; granted?: unknown };
  if (typeof input.appId !== "string" || typeof input.granted !== "boolean") {
    throw new Error("扩展同意参数无效");
  }
  return { appId: assertAppId(input.appId), granted: input.granted };
}

function assertBaseGuiConsentInput(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Base GUI 同意参数无效");
  }
  const input = raw as { appId?: unknown; grantedCapabilities?: unknown };
  const allowed = new Set([
    "row-insert",
    "row-patch",
    "row-delete",
    "attachment-read",
  ]);
  if (
    typeof input.appId !== "string" ||
    !Array.isArray(input.grantedCapabilities) ||
    input.grantedCapabilities.some(
      (item) => typeof item !== "string" || !allowed.has(item)
    )
  ) {
    throw new Error("Base GUI 同意参数无效");
  }
  return {
    appId: assertAppId(input.appId),
    grantedCapabilities: [...new Set(input.grantedCapabilities)] as import("../../../../shared/apps-ipc").BaseGuiCapability[],
  };
}

function assertPromoteInput(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("promote 参数无效");
  }
  const input = raw as {
    appId?: unknown;
    expectedConsentRevision?: unknown;
  };
  if (
    typeof input.appId !== "string" ||
    !Number.isInteger(input.expectedConsentRevision)
  ) {
    throw new Error("promote 参数无效");
  }
  return {
    appId: assertAppId(input.appId),
    expectedConsentRevision: input.expectedConsentRevision as number,
  };
}
