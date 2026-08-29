/**
 * [INPUT]: Depends on the backend runtime registry, AppStore/Installer/PackageController, maintenance gate, Electron, and confirmation windows and log files
 * [OUTPUT]: AppAgent Operations, Unified Agent selection, structured capability, current testing, installation logs and Extension are available
 * [POS]: The single responsibility module for the Agent/operation of the apps/service; Don't participate in turn custody or delete saga
 */

import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type {
  AppCapabilitiesSnapshot,
  AppInstallEvent,
  AppRecord,
  SetAppAgentInput,
} from "../../../../shared/apps-ipc";
import type { AppLocale } from "../../../../shared/i18n/locale";
import { translate } from "../../../../shared/i18n/runtime";
import {
  backendById,
  backendRuntimeRegistry,
  orderedBackends,
} from "../../backends";
import { installLogPath } from "../app-cleanup";
import type { AppInstaller } from "../app-installer";
import type { MaintenanceGate } from "../maintenance-gate";
import type { AppStore } from "../app-store";
import type { AppPackageController } from "../share/app-package-controller";
import { detectCliRequirements } from "../share/cli-detectors";
import type { AgentToolInventory } from "../runtime/agent-tools";

const LOG_TAIL_LIMIT = 256 * 1024;

type AppAgentOperationsDependencies = {
  userData: string;
  store: AppStore;
  installer(): AppInstaller;
  packages: AppPackageController;
  maintenanceGate: MaintenanceGate;
  inspectCapabilityInventory(appId: string): Promise<AgentToolInventory | null>;
  stop(appId: string): Promise<void>;
  emit(event: AppInstallEvent): void;
  window(): BrowserWindow | null;
  locale(): AppLocale;
};

export class AppAgentOperations {
  constructor(private readonly deps: AppAgentOperationsDependencies) {}

  async capabilities(appId: string): Promise<AppCapabilitiesSnapshot> {
    const record = this.requireRecord(appId);
    const requirements = record.manifest?.requirements?.tools ?? [];
    const agent =
      record.manifest?.kind === "server" || record.manifest?.kind === "static"
        ? record.manifest.agentRequirements
        : null;
    const needsInventory =
      requirements.some((item) => item.kind === "mcp") ||
      Boolean(agent?.mcpServers.length || agent?.skills.length);
    const [cli, config, inventory] = await Promise.all([
      detectCliRequirements(requirements),
      this.deps.packages.configs.read(appId),
      needsInventory
        ? this.deps.inspectCapabilityInventory(appId).catch(() => null)
        : Promise.resolve(null),
    ]);
    const cliById = new Map(cli.map((status) => [status.id, status]));
    const health = (kind: "mcp" | "skill", name: string) =>
      inventory
        ? (kind === "mcp" ? inventory.mcpServers : inventory.skills).has(name)
          ? ("healthy" as const)
          : ("missing" as const)
        : ("unknown" as const);
    return {
      appId,
      capturedAt: Date.now(),
      tools: requirements.map((requirement) => {
        if (requirement.kind === "config") {
          const value = requirement.configKey
            ? config.values[requirement.configKey]?.trim()
            : "";
          return {
            requirement,
            status: value ? ("satisfied" as const) : ("needs-config" as const),
            guidance: value ? null : "在通用设置中填写此配置",
          };
        }
        if (requirement.kind === "mcp") {
          const state = inventory
            ? inventory.mcpServers.has(requirement.id)
              ? ("satisfied" as const)
              : ("missing" as const)
            : ("unknown" as const);
          return {
            requirement,
            status: state,
            guidance:
              state === "satisfied"
                ? null
                : "前往 Settings > Tools 检查 MCP Server",
          };
        }
        const status = cliById.get(requirement.id);
        return {
          requirement,
          status: status?.installed
            ? ("satisfied" as const)
            : status?.detectable
              ? ("missing" as const)
              : ("unknown" as const),
          guidance: status?.installed
            ? null
            : requirement.note || "请按 App 文档安装 CLI",
        };
      }),
      agentTools: {
        mcpServers: (agent?.mcpServers ?? []).map((name) => ({
          name,
          health: health("mcp", name),
        })),
        skills: (agent?.skills ?? []).map((name) => ({
          name,
          health: health("skill", name),
        })),
      },
      dataCapability:
        record.domainIdentity?.kind === "base"
          ? { kind: "base", grantLevels: ["read", "row-write"] }
          : { kind: "none", grantLevels: [] },
      /* AppsService 在组合根用 durable grant projection 覆盖；此叶不持有授权账本。 */
      baseGuiCapability: { requested: [], effective: [] },
      settings: {
        toolsPath: "/settings/tools",
        extensionsPath: "/settings/extensions",
      },
    };
  }

  async setAgent(input: SetAppAgentInput) {
    const record = this.requireRecord(input.appId);
    if (input.role === "interactive") {
      if (input.agent === "auto") throw new Error("交互 Agent 不支持 Auto");
      await this.requireReadyBackend(input.agent);
      return this.deps.store.update(record.id, (current) => ({
        ...current,
        agent: input.agent as AgentBackendId,
      }));
    }

    const effective = await this.resolveMaintenanceBackend(input.agent);
    const owner = `set-agent:${Date.now()}`;
    this.deps.maintenanceGate.acquire(record.id, owner);
    try {
      await this.deps.installer().cancel(record.id);
      await this.deps.stop(record.id);
      const saved = await this.deps.store.update(record.id, (current) => {
        if (current.bindingRevision !== record.bindingRevision) {
          throw new Error("App Agent 设置已变化，请刷新后重试");
        }
        return {
          ...current,
          maintenanceAgent: effective.id,
          headlessConsent: {
            backend: effective.id,
            version: effective.version,
            consentAt: Date.now(),
          },
          bindingRevision: current.bindingRevision + 1,
        };
      });
      return saved;
    } finally {
      this.deps.maintenanceGate.release(record.id, owner);
    }
  }

  async resolvePresetAgent(): Promise<AgentBackendId> {
    return this.resolveMaintenanceBackend("auto")
      .then((backend) => backend.id)
      .catch(() => {
        const fallback = orderedBackends().find(
          (descriptor) => descriptor.maintenance && descriptor.headless
        );
        if (!fallback) throw new Error("没有可用于 App 的 Agent 后端");
        return fallback.id;
      });
  }

  async resolveMaintenanceBackend(requested: AgentBackendId | "auto") {
    const candidates = orderedBackends().filter(
      (descriptor) => descriptor.maintenance && descriptor.headless
    );
    const selected =
      requested === "auto"
        ? candidates
        : candidates.filter((descriptor) => descriptor.id === requested);
    for (const descriptor of selected) {
      const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
      const capabilities = snapshot.capabilities;
      if (
        snapshot.runtimeStatus === "installed" &&
        snapshot.authStatus === "authenticated" &&
        capabilities.maintenance &&
        ["install-analysis", "repair", "serve"].every((purpose) =>
          capabilities.headless.includes(
            purpose as "install-analysis" | "repair" | "serve"
          )
        )
      ) {
        return backendRuntimeRegistry.toBackendInfo(descriptor.id, snapshot);
      }
    }
    throw new Error(
      "App 安装与自动维护需要已就绪且已开放维护能力的 Agent"
    );
  }

  async appendLog(appId: string, line: string) {
    const directory = join(this.deps.userData, "logs", "apps");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(installLogPath(this.deps.userData, appId), `${line}\n`, {
      mode: 0o600,
    });
    this.deps.emit({ appId, type: "log", line });
  }

  async readLogTail(appId: string) {
    this.requireRecord(appId);
    const path = installLogPath(this.deps.userData, appId);
    try {
      const info = await stat(path);
      const length = Math.min(info.size, LOG_TAIL_LIMIT);
      const buffer = Buffer.alloc(length);
      const file = await open(path, "r");
      try {
        await file.read(buffer, 0, length, info.size - length);
      } finally {
        await file.close();
      }
      return buffer.toString("utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw cause;
    }
  }

  async confirmExtensions(record: AppRecord, details: string[]) {
    const window = this.deps.window();
    if (!window || window.isDestroyed()) return false;
    const locale = this.deps.locale();
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: [
        translate(locale, "settings.native.disableExtensions"),
        translate(locale, "settings.native.enableExtensions"),
      ],
      defaultId: 0,
      cancelId: 0,
      title: translate(locale, "settings.native.extensionTitle"),
      message: translate(locale, "settings.native.extensionMessage", {
        name: record.displayName,
      }),
      detail: [
        ...details,
        "",
        translate(locale, "settings.native.extensionDetail"),
      ].join("\n"),
    });
    return result.response === 1;
  }

  private async requireReadyBackend(id: AgentBackendId) {
    const descriptor = backendById(id);
    const snapshot = await backendRuntimeRegistry.resolve(id);
    if (
      snapshot.runtimeStatus !== "installed" ||
      snapshot.authStatus !== "authenticated"
    ) {
      throw new Error(`${descriptor.displayName} 当前不可用`);
    }
    return backendRuntimeRegistry.toBackendInfo(id, snapshot);
  }

  private requireRecord(appId: string) {
    const record = this.deps.store.get(appId);
    if (!record) throw new Error("App 不存在");
    return record;
  }
}
