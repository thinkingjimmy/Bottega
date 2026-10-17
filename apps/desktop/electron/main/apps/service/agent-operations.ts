/**
 * [INPUT]: Depends on purpose-scoped maintenance selection, the backend registry, AppStore, PackageController and log files.
 * [OUTPUT]: Projects static App tools and cached inventory, selects qualified installation Agents by purpose; Chats own interactive Agent selection.
 * [POS]: apps/service Agent-operations module; excluded from turn custody and the delete saga
 */

import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import type {
  AppCapabilitiesSnapshot,
  AppInstallEvent,
} from "../../../../shared/ipc/apps/apps-ipc";
import {
  backendRuntimeRegistry,
  orderedBackends,
} from "../../backends";
import { installLogPath } from "../maintenance/app-cleanup";
import type { AppStore } from "../store/app-store";
import type { AppPackageController } from "../share/app-package-controller";
import { detectCliRequirements } from "../share/cli-detectors";
import type { AgentToolInventory } from "../runtime/agent-tools";
import { resolveMaintenanceAgent } from "../runtime/maintenance-agent";

const LOG_TAIL_LIMIT = 256 * 1024;

type AppAgentOperationsDependencies = {
  userData: string;
  store: AppStore;
  packages: AppPackageController;
  inspectCapabilityInventory(appId: string): Promise<AgentToolInventory | null>;
  emit(event: AppInstallEvent): void;
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
    const selected = await resolveMaintenanceAgent("install-analysis", { requested });
    return backendRuntimeRegistry.toBackendInfo(selected.descriptor.id, selected.snapshot);
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

  private requireRecord(appId: string) {
    const record = this.deps.store.get(appId);
    if (!record) throw new Error("App 不存在");
    return record;
  }
}
