/**
 * [INPUT]: Depends on DesignService, AppStore, Base GUI grants, trusted surface leases, workspace plus current-chat identity resolution, factory import, and Apps event callbacks
 * [OUTPUT]: Provides AppDesignIntegration for request-bound Design turn watching, incarnation-fenced tool reads, workspace/history access, custody controls, main-evidence Project rebind migration, factory lifecycle/explicit reinstall, and renderer events
 * [POS]: apps/service Design composition boundary; AppsService delegates the complete Design capability family here
 */

import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import type { BaseGuiLiveBinding } from "../../../../../shared/apps-ipc";
import type { EffectiveWorkspaceResolver } from "../../../workspace-resolver";
import { DESIGN_PRESET_ID } from "../../../design/enabled";
import { designFactoryPayloadPath } from "../../../design/factory-path";
import { createDesignFactoryPorts } from "../../../design/provisioning/factory-app-adapter";
import { DesignFactoryPresetFlow } from "../../../design/provisioning/factory-preset-flow";
import {
  DesignService,
  type DesignProjectRebindEvidence,
} from "../../../design/service";
import type { AppGrantAuthority } from "../../attachments/grant-authority";
import type { AppAttachmentSurfaceLeaseRegistry } from "../../attachments/surface-leases";
import type { WorkspacePreviewPort } from "../../base-gui/workspace-preview";
import type { BaseGuiGrantStore } from "../../base-gui/grant-store";
import type { BaseAppImporter } from "../../install/import-base-app";
import type { AppStore } from "../../app-store";

type FactoryDescriptor = Readonly<{
  presetId: typeof DESIGN_PRESET_ID;
  repoUrl: string;
  catalogPin: string;
  treeDigest: string;
}>;

type DesignIntegrationPorts = Readonly<{
  surfaceLeases(): AppAttachmentSurfaceLeaseRegistry;
  grantAuthority(): AppGrantAuthority;
  configureWorkspacePreview(port: WorkspacePreviewPort): void;
  emit(event:
    | Readonly<{ appId: string; type: "gui" }>
    | Readonly<{
        type: "design-canvases-changed";
        appId: string;
        chatId: string;
        conversationIncarnationId: string;
        turnId: string;
        files: readonly string[];
        drafting: boolean;
      }>): void;
  invalidateSkills(): void;
  factoryDescriptor(): FactoryDescriptor;
}>;

function requireLease(binding: BaseGuiLiveBinding) {
  if (binding.appSurfaceLeaseId) return binding.appSurfaceLeaseId;
  throw Object.assign(new Error("Design workspace 缺少 surface lease"), {
    status: 401,
  });
}

export class AppDesignIntegration {
  readonly service: DesignService;
  private effectiveWorkspaceResolver: EffectiveWorkspaceResolver | null = null;
  private getConversationIncarnation: ((chatId: string) => string | undefined) | null = null;
  private surfaceLeases: AppAttachmentSurfaceLeaseRegistry | null = null;
  private factoryPreset: DesignFactoryPresetFlow | null = null;

  constructor(
    userData: string,
    private readonly store: AppStore,
    private readonly guiGrants: BaseGuiGrantStore,
    private readonly ports: DesignIntegrationPorts
  ) {
    this.service = new DesignService(userData, store);
  }

  initialize() {
    return this.service.initialize();
  }

  configureWorkspace(
    resolveEffectiveWorkspace: EffectiveWorkspaceResolver,
    getConversationIncarnation: (chatId: string) => string | undefined
  ) {
    this.effectiveWorkspaceResolver = resolveEffectiveWorkspace;
    this.getConversationIncarnation = getConversationIncarnation;
    this.surfaceLeases?.configureWorkspaceAuthority(resolveEffectiveWorkspace);
    this.service.configureWorkspace({
      describeSurface: (surfaceLeaseId) =>
        this.ports.surfaceLeases().describe(surfaceLeaseId),
      resolveEffectiveWorkspace,
    });
    this.ports.configureWorkspacePreview({
      list: (binding) => this.listFiles(binding),
      read: (binding, path) => this.readFile(binding, path),
      listVersions: (binding, path) => this.listVersions(binding, path),
      readVersion: (binding, versionId) => this.readVersion(binding, versionId),
    });
    this.service.configureEvents((event) => {
      if (event.type === "workspace-authority-changed") {
        this.ports.surfaceLeases().revokeApp(event.appId);
        this.ports.emit({ appId: event.appId, type: "gui" });
        return;
      }
      this.ports.emit({
        type: "design-canvases-changed",
        appId: event.appId,
        chatId: event.chatId,
        conversationIncarnationId: event.conversationIncarnationId,
        turnId: event.turnId,
        files: event.files,
        drafting: event.drafting,
      });
    });
  }

  configureSurfaceLeases(registry: AppAttachmentSurfaceLeaseRegistry) {
    this.surfaceLeases = registry;
    if (this.effectiveWorkspaceResolver) {
      registry.configureWorkspaceAuthority(this.effectiveWorkspaceResolver);
    }
  }

  async armTurn(input: {
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
    explicitDesign: boolean;
  }) {
    const appId = this.service.enabled.enabledAppId();
    const resolved = this.effectiveWorkspaceResolver?.({
      kind: "conversation",
      conversationId: input.chatId,
    });
    if (!appId || !resolved || resolved.kind !== "ready") return false;
    if (input.explicitDesign) await this.service.clearAutoOpenSuppression(input);
    return this.service.armTurn({
      appId,
      workspace: resolved.workspace,
      authorityIdentity: resolved.authorityIdentity,
      stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
      chatId: input.chatId,
      conversationIncarnationId: input.conversationIncarnationId,
      turnId: input.turnId,
    });
  }

  settleTurn(
    chatId: string,
    conversationIncarnationId: string,
    turnId: string
  ) {
    return this.service.settleTurn({
      chatId,
      conversationIncarnationId,
      turnId,
    });
  }

  async importCanvas(surfaceLeaseId: string, relativePath: string) {
    const entry = await this.service.importCanvas({ surfaceLeaseId }, relativePath);
    return { file: entry.canonicalRelativePath };
  }

  listImportCandidates(surfaceLeaseId: string) {
    return this.service.listImportCandidates({ surfaceLeaseId });
  }

  async listSurfaceFiles(surfaceLeaseId: string) {
    return (await this.service.listWorkspaceDesignFiles({ surfaceLeaseId })).files;
  }

  async readCanvasForTool(chatId: string, incarnationId: string, relativePath: string) {
    if (this.getConversationIncarnation?.(chatId) !== incarnationId) {
      throw Object.assign(new Error("Design tool lease is stale for this chat incarnation"), {
        status: 409,
      });
    }
    const appId = this.service.enabled.enabledAppId();
    const resolved = this.effectiveWorkspaceResolver?.({
      kind: "conversation",
      conversationId: chatId,
    });
    if (!appId || !resolved || resolved.kind !== "ready") {
      throw Object.assign(new Error("Design is not available for this chat"), { status: 404 });
    }
    if (this.getConversationIncarnation?.(chatId) !== incarnationId) {
      throw Object.assign(new Error("Design tool lease changed during workspace resolution"), {
        status: 409,
      });
    }
    return this.service.readCanvasForTool({
      workspace: resolved.workspace,
      authorityIdentity: resolved.authorityIdentity,
      stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
    }, relativePath);
  }

  listSurfaceVersions(surfaceLeaseId: string, relativePath: string) {
    return this.service.listVersions({ surfaceLeaseId }, relativePath);
  }

  restoreSurfaceVersion(surfaceLeaseId: string, versionId: string) {
    return this.service.restoreVersion({ surfaceLeaseId }, versionId);
  }

  async setAutoOpen(input: {
    appId: string;
    chatId: string;
    conversationIncarnationId: string;
    suppressed: boolean;
  }) {
    if (!this.service.enabled.isAppEnabled(input.appId)) return false;
    if (input.suppressed) await this.service.suppressAutoOpen(input);
    else await this.service.clearAutoOpenSuppression(input);
    return true;
  }

  dataStatus(appId: string) {
    const data = this.resolveAppData(appId);
    return data
      ? {
          dataCustodyId: data.dataCustodyId,
          stableWorkspaceOwnerId: data.stableWorkspaceOwnerId,
        }
      : null;
  }

  async deleteData(input: {
    appId: string;
    dataCustodyId: string;
    confirmed: true;
  }) {
    return Boolean(await this.service.deleteCustodyData(input));
  }

  async migrateProjectWorkspace(evidence: DesignProjectRebindEvidence) {
    await this.service.migrateProjectWorkspace(evidence);
    return true;
  }

  async setEnabled(appId: string, enabled: boolean) {
    if (this.store.get(appId)?.presetId !== DESIGN_PRESET_ID) {
      throw new Error("Only the Design factory can change Design visibility");
    }
    return this.ports.grantAuthority().setDefaultGrant({
      appId,
      grant: enabled
        ? {
            requestedDataLevel: "none",
            requestedAgentDelegation: { fileRead: true, useData: false },
          }
        : null,
    });
  }

  resolveAppData(appId: string) {
    if (this.store.get(appId)?.presetId !== DESIGN_PRESET_ID) return undefined;
    return this.service.resolveAppData(appId) ?? null;
  }

  listFiles(binding: BaseGuiLiveBinding) {
    return this.service.listWorkspaceDesignFiles({ surfaceLeaseId: requireLease(binding) });
  }

  async readFile(binding: BaseGuiLiveBinding, relativePath: string) {
    try {
      return await this.service.readWorkspaceDesignFile(
        { surfaceLeaseId: requireLease(binding) },
        relativePath
      );
    } catch (cause) {
      const status = Number((cause as { status?: unknown } | null)?.status);
      const code = (cause as NodeJS.ErrnoException | null)?.code;
      if (status === 404 || code === "ENOENT") return null;
      throw cause;
    }
  }

  listVersions(binding: BaseGuiLiveBinding, relativePath: string) {
    return this.service.listVersions(
      { surfaceLeaseId: requireLease(binding) },
      relativePath
    );
  }

  readVersion(binding: BaseGuiLiveBinding, versionId: string) {
    return this.service.readVersion(
      { surfaceLeaseId: requireLease(binding) },
      versionId
    );
  }

  configureFactory(input: {
    importer: BaseAppImporter;
    grants: AppGrantAuthority;
    resolveAgent(): Promise<AgentBackendId>;
  }) {
    this.service.configureFactory(createDesignFactoryPorts({
      store: this.store,
      importer: input.importer,
      grants: input.grants,
      guiGrants: this.guiGrants,
      resolveAgent: input.resolveAgent,
      activateCustody: async (appId) => {
        await this.service.activateFactoryCustody(appId);
      },
    }));
    const sourceRoot = designFactoryPayloadPath();
    const trust = this.ports.factoryDescriptor();
    this.factoryPreset = new DesignFactoryPresetFlow(
      sourceRoot,
      trust,
      async () => {
        const state = await this.service.reinstallFactory(sourceRoot, trust);
        const record = state.appId ? this.store.get(state.appId) : undefined;
        if (!record) throw new Error("Design factory 显式重装未生成 App");
        this.ports.invalidateSkills();
        return record;
      }
    );
  }

  factoryPresetFlow() {
    if (!this.factoryPreset) throw new Error("Design factory preset flow 尚未配置");
    return this.factoryPreset;
  }

  async ensureFactory(reset = false) {
    const descriptor = this.ports.factoryDescriptor();
    const operation = reset ? this.service.resetFactoryToPin : this.service.ensureFactory;
    const result = await operation.call(
      this.service,
      designFactoryPayloadPath(),
      descriptor
    );
    this.ports.invalidateSkills();
    return result;
  }

  closeAndFlush() {
    return this.service.closeAndFlush();
  }
}
