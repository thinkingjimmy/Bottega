/**
 * [INPUT]: Depends on the injectable rendererIpc registrar, Apps shared channels/input assertions, trusted Studio residence and renderer identity, generic store/runtime/grant/package ports, and the delegated Design registrar
 * [OUTPUT]: Registers Apps management, fenced grant-candidate queries, main-owned typed App Use history/open/switch, recordless delete retry, Editor destination channels, structured add rejection, symmetric Studio authorize/decline/revoke, the studioSurfaceReady list projection, exact staged GUI readiness, renderer-owned GUI teardown, and fixed-App Studio channels
 * [POS]: apps/service generic renderer adapter; Design command parsing and authority live in integrations/design-ipc.ts
 */

import { join } from "node:path";
import { shell, type BrowserWindow } from "electron";
import { customAlphabet } from "nanoid";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  APPS_CHANNEL,
  repairSite,
  type AddAppResult,
  type AppCapabilitiesSnapshot,
  type AppExtensionStatus,
  type AppGuiInfo,
  type AppGuiInfoInput,
  type AppGuiReadyInput,
  type AppGuiReadyResult,
  type AppInstallEvent,
  type AppRecord,
  type AppRuntimeStatus,
  type AppRecordProjection,
  type AppsProjectionSnapshot,
  type EnsureAppChatSlotInput,
  type RemoveAppMode,
  type RenameAppInput,
  type SaveAsAppResult,
  type SetAppAgentInput,
  type BeginFileExportInputV1,
  type BeginFileExportResultV1,
  type CompleteFileExportInputV1,
  type CompleteFileExportResultV1,
  type WriteFileExportChunkInputV1,
  beginFileExportInputV1Schema,
  completeFileExportInputV1Schema,
  parseWriteFileExportChunkInputV1,
} from "../../../../shared/apps-ipc";
import {
  rendererIpc,
  type RendererIpc,
  type RendererIpcRegistrar,
} from "../../ipc-registrar";
import { rendererIdentity } from "../../window/renderer-identity";
import type { AppDeleteService } from "../app-delete";
import type { AppInstaller } from "../app-installer";
import type { AppRuntime } from "../app-runtime";
import type { AppStore } from "../app-store";
import type { AppGrantAuthority } from "../attachments/grant-authority";
import {
  assertAppGrantTarget,
  assertAppGrantCandidatesInput,
  assertAppGuiInfoInput,
  assertAppGuiReadyInput,
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
  assertListAppUseHistoryInput,
  assertOpenAppEditorInput,
  assertOpenAppEditorChatInput,
  assertOpenAppUseChatInput,
  assertRemoveMode,
  assertRenameInput,
  assertSaveAsAppInput,
  assertSetAgentInput,
  assertSetPinnedInput,
} from "../service-inputs";
import type { AppPackageController } from "../share/app-package-controller";
import {
  assertAddAppInput,
  createInstallingAppRecord,
  normalizeGithubRepoUrl,
} from "../support";
import type { AppLifecycleAdmissionGate } from "../../lifecycle/app-platform-admission";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import {
  registerDesignIpc,
  type DesignIpcDependencies,
} from "./integrations/design-ipc";

type AppsIpcDependencies = DesignIpcDependencies & {
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
  authorizeStudioAccess(appId: string): Promise<AppRecord>;
  declineStudioAccess(appId: string): Promise<AppRecord>;
  revokeStudioAccess(appId: string): Promise<AppRecord>;
  studioSurfaceReady(record: AppRecord): boolean;
  revokeExtensionGrant(appId: string): Promise<AppExtensionStatus>;
  rebuildExtensionGeneration(appId: string): Promise<AppRecord>;
  remove(appId: string, mode?: RemoveAppMode, requestId?: string): Promise<void>;
  readLogTail(appId: string): Promise<string>;
  setAgent(input: SetAppAgentInput): Promise<AppRecord>;
  rename(input: RenameAppInput): Promise<AppRecord>;
  ensureChatSlot(input: EnsureAppChatSlotInput): unknown;
  listUseHistory(input: import("../../../../shared/apps-ipc").ListAppUseHistoryInput): unknown;
  openUseChat(input: import("../../../../shared/apps-ipc").OpenAppUseChatInput): unknown;
  newUseChat(appId: string, requestId: string): unknown;
  openEditor(input: import("../../../../shared/apps-ipc").OpenAppEditorInput): unknown;
  openEditorChat(input: import("../../../../shared/apps-ipc").OpenAppEditorChatInput): unknown;
  hideEditor(appId: string): unknown;
  guiInfo(input: AppGuiInfoInput, context: TrustedRendererContext): Promise<AppGuiInfo>;
  guiReady(input: AppGuiReadyInput): Promise<AppGuiReadyResult>;
  releaseGuiSurface(input: AppGuiInfoInput, context: TrustedRendererContext): Promise<void>;
  fileExportBegin(input: BeginFileExportInputV1): Promise<BeginFileExportResultV1>;
  fileExportWrite(input: WriteFileExportChunkInputV1): Promise<unknown>;
  fileExportFinalize(input: CompleteFileExportInputV1): Promise<CompleteFileExportResultV1>;
  fileExportCancel(input: CompleteFileExportInputV1): Promise<CompleteFileExportResultV1>;
  resolveMaintenanceBackend(requested: AgentBackendId | "auto"): Promise<{
    id: AgentBackendId;
    version?: string;
  }>;
  resolvePresetAgent(): Promise<AgentBackendId>;
  onClosed(): void;
};

export async function retryAppOperation(
  deps: Pick<
    AppsIpcDependencies,
    "appDelete" | "installer" | "packages" | "requireRecord"
  >,
  appId: string
) {
  const deletion = deps.appDelete();
  if (deletion && await deletion.residual(appId)) {
    await deletion.retry(appId);
    return;
  }
  const record = deps.requireRecord(appId);
  if (await deps.packages.hasPendingImport(appId)) {
    await deps.packages.retryPendingImport(appId);
  } else if (record.state === "install-failed") {
    await deps.installer.retryInstall(appId);
  } else if (record.state === "update-failed") {
    await deps.installer.retryUpdate(appId);
  } else if (record.state === "delete-failed") {
    if (!deletion) throw new Error("App 删除尚未初始化");
    await deletion.retry(appId);
  } else {
    throw new Error("当前状态不能重试");
  }
}

const createAppId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyz0123456789",
  10
);

export function registerAppPinIpc(
  ipc: RendererIpc,
  store: Pick<AppStore, "setPinned">
) {
  return ipc.handle(APPS_CHANNEL.setPinned, (value) => {
    const input = assertSetPinnedInput(value);
    return store.setPinned(input.appId, input.pinned);
  });
}

export const duplicateAddAppResult = (appId: string): AddAppResult => ({
  status: "rejected",
  error: { code: "DUPLICATE_REPOSITORY", appId },
});

export function registerAppsIpc(
  window: BrowserWindow,
  rendererUrl: string,
  deps: AppsIpcDependencies,
  registerIpc: RendererIpcRegistrar = rendererIpc
) {
  const mainIpc = registerIpc(
    window,
    rendererUrl,
    "拒绝非主窗口的 Apps 管理请求"
  );
  const studioIpc = registerIpc(
    window,
    rendererUrl,
    "拒绝非受信窗口的 App Studio 请求"
  ).roles("main", "app-window");

  registerAppPinIpc(mainIpc, deps.store);

  mainIpc.handle(APPS_CHANNEL.add, async (value) => {
      const input = assertAddAppInput(value);
      const normalized = normalizeGithubRepoUrl(input.repoUrl);
      const duplicate = deps.store
        .list()
        .find((record) => record.sourceRepoUrl === normalized.repoUrl);
      if (duplicate) return duplicateAddAppResult(duplicate.id);
      if (input.preflightId || input.confirmedDigest) {
        if (!input.preflightId || !input.confirmedDigest) {
          throw new Error("Base App preflight 参数不完整");
        }
        const maintenance = await deps.resolveMaintenanceBackend(
          input.maintenanceAgent
        );
        const record = await deps.packages.importBase({
          request: input,
          repoUrl: normalized.repoUrl,
          agent: maintenance.id,
        });
        return { status: "done", record } satisfies AddAppResult;
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
      deps.installer.enqueue(id);
      return { status: "done", record: saved } satisfies AddAppResult;
    })
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
      return deps
        .grantAuthority()
        .setDefaultGrant(assertSetDefaultAppGrantInput(input));
    })
    .handle(APPS_CHANNEL.listGrantSources, () =>
      deps.grantAuthority().listSources()
    )
    .handle(APPS_CHANNEL.listGrantCandidates, (input) =>
      deps.grantAuthority().listCandidates(assertAppGrantCandidatesInput(input))
    )
    .handle(APPS_CHANNEL.listAvailable, (input) =>
      deps.grantAuthority().listAvailable(assertAvailableAppsInput(input))
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
    .handle(APPS_CHANNEL.acquireManagementLease, (rawId) => ({
      managementLeaseId: deps.managementLeases().issue({
        appId: assertAppId(rawId),
        ...rendererIdentity(window.webContents.id),
      }).managementLeaseId,
    }))
    .handle(APPS_CHANNEL.releaseManagementLease, (leaseId) =>
      deps.managementLeases().release(assertSurfaceLeaseId(leaseId))
    )
    .handle(APPS_CHANNEL.authorizeStudioAccess, (rawId) =>
      deps.authorizeStudioAccess(assertAppId(rawId))
    )
    /* 拒绝与同意走同一道门：一个 appId 进去，一份新记录出来。丢弃 pending
       会改变 GUI 可见性，故与撤权一样广播 `gui`。 */
    .handle(APPS_CHANNEL.declineStudioAccess, async (rawId) => {
      const saved = await deps.declineStudioAccess(assertAppId(rawId));
      deps.emit({ appId: saved.id, type: "gui" });
      return saved;
    })
    .handle(APPS_CHANNEL.revokeStudioAccess, async (rawId) => {
      const saved = await deps.revokeStudioAccess(assertAppId(rawId));
      deps.emit({ appId: saved.id, type: "gui" });
      return saved;
    })
    .handle(APPS_CHANNEL.retry, async (rawId) => {
      const appId = assertAppId(rawId);
      await retryAppOperation(deps, appId);
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
    .handle(APPS_CHANNEL.retrySkill, (rawId) => {
      const service = deps.saveAsApp();
      if (!service) throw new Error("Save as App 尚未初始化");
      return service.retrySkill(assertAppId(rawId));
    })
    .handle(APPS_CHANNEL.remove, (rawId, rawMode, rawRequestId) =>
      deps.remove(
        assertAppId(rawId),
        assertRemoveMode(rawMode),
        typeof rawRequestId === "string" ? rawRequestId : ""
      )
    );

  /* 派生一次，随记录一起上桌：Studio 面能否开出来是 main 的判词，renderer
     从前自己比 generationId + contentDigest 两项，兼容重绑后就与 surface
     的放行判据分了家。投影不进持久化 schema——它是朗读，不是账本。 */
  const project = (record: AppRecord): AppRecordProjection => ({
    ...record,
    studioSurfaceReady: deps.studioSurfaceReady(record),
  });

  studioIpc
    .handleWithContext(APPS_CHANNEL.list, (context) => {
      if (context.role !== "app-window") {
        return {
          apps: deps.store.list().map(project),
          runtimeWarning: deps.gatewayWarning(),
        } satisfies AppsProjectionSnapshot;
      }
      const appId = context.appId;
      if (!appId) throw new Error("App window is missing its fixed App identity");
      surfaceWindowController.assertAppStudioMutation(context, appId);
      const record = deps.store.get(appId);
      return {
        apps: record ? [project(record)] : [],
        runtimeWarning: deps.gatewayWarning(),
      } satisfies AppsProjectionSnapshot;
    })
    .handleWithContext(APPS_CHANNEL.open, (context, rawId) => {
      const appId = assertAppId(rawId);
      assertFixedAppStudio(context, appId);
      return openRuntime(deps, appId);
    })
    .handleWithContext(APPS_CHANNEL.status, (context, rawId) => {
      const appId = assertAppId(rawId);
      assertFixedAppStudio(context, appId);
      return deps.runtimeStatus(appId);
    })
    .handleWithContext(APPS_CHANNEL.originWithoutStart, (context, rawId) => {
      const appId = assertAppId(rawId);
      assertFixedAppStudio(context, appId);
      return deps.originWithoutStart(appId);
    })
    .handleWithContext(APPS_CHANNEL.listPresets, (context) =>
      context.role === "app-window" ? [] : deps.packages.presets.list()
    )
    .handleWithContext(APPS_CHANNEL.readReadme, (context, rawId) => {
      const appId = assertAppId(rawId);
      if (context.role === "app-window") {
        if (context.appId !== appId) throw new Error("App window README scope mismatch");
        surfaceWindowController.assertAppStudioMutation(context, appId);
      }
      return deps.packages.readReadme(deps.requireRecord(appId));
    })
    .handleWithContext(APPS_CHANNEL.acquireSurface, (context, raw) => {
      const input = assertAppSurfaceAcquireInput(raw);
      if (input.mode === "studio") {
        surfaceWindowController.assertAppStudioMutation(context, input.appId);
      }
      surfaceWindowController.assertConversationMutation(
        context,
        input.conversationId
      );
      return deps.surfaceLeases().acquire(input, context);
    })
    .handleBestEffortWithContext(APPS_CHANNEL.releaseSurface, (context, rawLeaseId) =>
      deps.surfaceLeases().releaseFromRenderer(
        assertSurfaceLeaseId(rawLeaseId),
        context
      )
    )
    .handleWithContext(APPS_CHANNEL.ensureChatSlot, (context, value) => {
      const input = assertChatSlotInput(value);
      assertFixedAppStudio(context, input.appId);
      return deps.ensureChatSlot(input);
    })
    .handleWithContext(APPS_CHANNEL.listUseHistory, (context, value) => {
      const input = assertListAppUseHistoryInput(value);
      assertFixedAppStudio(context, input.appId);
      return deps.listUseHistory(input);
    })
    .handleWithContext(APPS_CHANNEL.openUseChat, (context, value) => {
      const input = assertOpenAppUseChatInput(value);
      assertFixedAppStudio(context, input.appId);
      return deps.openUseChat(input);
    })
    .handleWithContext(APPS_CHANNEL.newUseChat, (context, rawId, rawRequestId) => {
      const appId = assertAppId(rawId);
      assertFixedAppStudio(context, appId);
      if (
        typeof rawRequestId !== "string" ||
        !rawRequestId ||
        rawRequestId.length > 256
      ) {
        throw new Error("App Use New Chat requestId 无效");
      }
      return deps.newUseChat(appId, rawRequestId);
    })
    .handleWithContext(APPS_CHANNEL.openEditor, (context, value) => {
      const input = assertOpenAppEditorInput(value);
      assertFixedAppStudio(context, input.appId);
      return deps.openEditor(input);
    })
    .handleWithContext(APPS_CHANNEL.openEditorChat, (context, value) => {
      const input = assertOpenAppEditorChatInput(value);
      assertFixedAppStudio(context, input.appId);
      return deps.openEditorChat(input);
    })
    .handleWithContext(APPS_CHANNEL.hideEditor, (context, rawId) => {
      const appId = assertAppId(rawId);
      assertFixedAppStudio(context, appId);
      return deps.hideEditor(appId);
    })
    .handleWithContext(APPS_CHANNEL.guiInfo, async (context, raw) => {
      const input = assertAppGuiInfoInput(raw);
      if (deps.requireRecord(input.appId).manifest?.kind !== "base") {
        throw new Error("GUI 信息只对 Base App 提供");
      }
      const surface = await deps.surfaceLeases().describe(
        input.appSurfaceLeaseId
      );
      /* 面租约必须属于所请求的 App：驻留校验只证「同窗」，证不了「同 App」——
         否则 A 的 origin 可拿 B 的租约铸绑定，读走 B 会话的 design 树。 */
      if (surface.appId !== input.appId) {
        throw new Error("Surface lease does not belong to the requested App");
      }
      assertSurfaceMutation(context, surface);
      return deps.guiInfo(input, context);
    })
    .handleWithContext(APPS_CHANNEL.guiReady, async (context, raw) => {
      const input = assertAppGuiReadyInput(raw);
      const surface = await deps.surfaceLeases().describe(
        input.appSurfaceLeaseId
      );
      if (surface.appId !== input.appId) {
        throw new Error("Ready surface does not belong to the requested App");
      }
      assertSurfaceMutation(context, surface);
      return deps.guiReady(input);
    })
    .handleBestEffortWithContext(APPS_CHANNEL.releaseGuiSurface, async (context, raw) => {
      const input = assertAppGuiInfoInput(raw);
      assertFixedAppStudio(context, input.appId);
      return deps.releaseGuiSurface(input, context);
    })
    .handleWithContext(APPS_CHANNEL.fileExportBegin, async (context, raw) => {
      const input = beginFileExportInputV1Schema.parse(raw);
      await assertFileExportSurface(context, input.surface, deps);
      return deps.fileExportBegin(input);
    })
    .handleWithContext(APPS_CHANNEL.fileExportWrite, async (context, raw) => {
      const input = parseWriteFileExportChunkInputV1(raw);
      await assertFileExportSurface(context, input.surface, deps);
      return deps.fileExportWrite(input);
    })
    .handleWithContext(APPS_CHANNEL.fileExportFinalize, async (context, raw) => {
      const input = completeFileExportInputV1Schema.parse(raw);
      await assertFileExportSurface(context, input.surface, deps);
      return deps.fileExportFinalize(input);
    })
    .handleWithContext(APPS_CHANNEL.fileExportCancel, async (context, raw) => {
      const input = completeFileExportInputV1Schema.parse(raw);
      await assertFileExportSurface(context, input.surface, deps);
      return deps.fileExportCancel(input);
    });

  registerDesignIpc(studioIpc, deps);

  deps.packages.register(
    mainIpc,
    {
      assertAppId,
      requireRecord: deps.requireRecord,
      normalizeRepo: normalizeGithubRepoUrl,
      resolvePresetAgent: deps.resolvePresetAgent,
    }
  );
  window.once("closed", deps.onClosed);
}

async function assertFileExportSurface(
  context: Parameters<AppAttachmentSurfaceLeaseRegistry["rendererSurfaceForRelease"]>[1],
  input: BeginFileExportInputV1["surface"],
  deps: AppsIpcDependencies
) {
  const surface = await deps.surfaceLeases().describe(input.appSurfaceLeaseId);
  if (surface.appId !== input.appId) throw new Error("File export surface does not belong to the requested App");
  assertSurfaceMutation(context, surface);
}

async function openRuntime(deps: AppsIpcDependencies, appId: string) {
  const result = await deps.lifecycleGate.run(appId, () => {
    const record = deps.requireRecord(appId);
    if (!deps.lifecycleGate.isOpen(appId) || record.state !== "ready") {
      throw Object.assign(
        new Error("APP_LIFECYCLE_ADMISSION_CLOSED: App 正在换代，稍后再打开"),
        { status: 409 }
      );
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
}

export function assertFixedAppStudio(
  context: import("../../window/surfaces/trusted-renderer-context").TrustedRendererContext,
  appId: string
) {
  if (context.role !== "app-window") return;
  if (context.appId !== appId) throw new Error("App window scope mismatch");
  surfaceWindowController.assertAppStudioMutation(context, appId);
}

function assertSurfaceMutation(
  context: import("../../window/surfaces/trusted-renderer-context").TrustedRendererContext,
  surface: import("../../../../shared/apps-ipc").AppAttachmentSurface
) {
  if (surface.mode === "studio") {
    surfaceWindowController.assertSurfaceResidence({
      windowId: context.windowId,
      appId: surface.appId,
      conversationId: surface.conversationId,
      conversationIncarnationId: surface.conversationIncarnationId,
    });
    return;
  }
  surfaceWindowController.assertConversationSurfaceResidence({
    windowId: context.windowId,
    conversationId: surface.conversationId,
    conversationIncarnationId: surface.conversationIncarnationId,
  });
}


