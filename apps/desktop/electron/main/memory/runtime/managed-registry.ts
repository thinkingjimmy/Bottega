/**
 * [INPUT]: Depends on the provider registry installSpec/descriptor/createProvider, ManagedRuntimeCoordinator, memoryLifecycle Orchestrator, rendererIpc and shared renderer command/capability agreement
 * [OUTPUT]: Provides ManagedRuntimeRegistry: installation provider private readiness, coordinator, owner, provider-reserved version directory/switch, configuration and renderer IPC, registrar can be inserted)
 * [POS]: The main/memory/runtime host running time boundary; The first is the renderer, which is never directed to the Coordinator
 */

import type { BrowserWindow } from "electron";
import { join } from "node:path";
import {
  MEMORY_CHANNEL,
  type MemoryConfigIssue,
  type MemoryConfigIssueAction,
  type MemoryDestructiveOperation,
  type MemoryRuntimeRendererCommand,
  type MemoryRuntimeOperation,
  type MemoryRuntimeSnapshot,
  type MemoryRuntimeConfigMutation,
} from "../../../../shared/memory-ipc";
import { rendererIpc, type RendererIpcRegistrar } from "../../ipc-registrar";
import { MEMORY_PROVIDER_MODULES } from "../providers/registry";
import {
  ManagedRuntimeCoordinator,
  type CoordinatorOptions,
} from "./control/coordinator";
import type { MemoryLifecycleOrchestrator } from "./control/lifecycle-orchestrator";
import { readProviderRuntimeHealth } from "./control/health-monitor";
import {
  defaultDownloader,
  defaultRunCommandCaptured,
} from "./managed/install-steps";
import { ManagedToolchain } from "./managed/toolchain";

const RENDERER_COMMANDS: MemoryRuntimeRendererCommand[] = [
  "install",
  "repair",
  "upgrade",
  "switch-version",
];

const DESTRUCTIVE_OPERATIONS: MemoryDestructiveOperation[] = [
  "uninstall",
  "rebuild",
];

export type ManagedRuntimeRegistryOptions =
  Omit<CoordinatorOptions, "onPublish" | "readHealth"> &
  Pick<Partial<CoordinatorOptions>, "readHealth">;

export class ManagedRuntimeRegistry {
  private readonly coordinators = new Map<string, ManagedRuntimeCoordinator>();
  private readonly publishedRevision = new Map<string, number>();
  private window: BrowserWindow | null = null;
  private lifecycle: MemoryLifecycleOrchestrator | null = null;

  constructor(
    userData: string,
    private readonly options: ManagedRuntimeRegistryOptions = {}
  ) {
    const runCaptured = options.runCommandCaptured ?? defaultRunCommandCaptured();
    const toolchain =
      options.toolchain ??
      new ManagedToolchain(join(userData, "memory-tools"), {
        runCaptured,
        download: options.download ?? defaultDownloader,
      });
    for (const module of MEMORY_PROVIDER_MODULES) {
      if (!module.installSpec) continue;
      this.coordinators.set(
        module.descriptor.id,
        new ManagedRuntimeCoordinator(
          userData,
          module.descriptor,
          module.installSpec,
          {
            ...options,
            readHealth: options.readHealth ?? ((baseUrl) =>
              readProviderRuntimeHealth(module.createProvider({ baseUrl }))
            ),
            runCommandCaptured: runCaptured,
            toolchain,
            ...(module.configPanel ? { configPanel: module.configPanel } : {}),
            onPublish: (snapshot) => this.publish(snapshot),
          }
        )
      );
    }
  }

  get(providerId: string) {
    return this.coordinators.get(providerId) ?? null;
  }

  require(providerId: string) {
    const coordinator = this.get(providerId);
    if (!coordinator) {
      throw new Error(`${providerId} 不是托管运行时，无法执行该操作`);
    }
    return coordinator;
  }

  snapshot(providerId: string) {
    return this.require(providerId).snapshot();
  }

  refresh(providerId: string) {
    return this.requireLifecycle().refreshRuntime(providerId);
  }

  setLifecycleOrchestrator(lifecycle: MemoryLifecycleOrchestrator) {
    this.lifecycle = lifecycle;
  }

  async run(
    providerId: string,
    operation: MemoryRuntimeRendererCommand,
    version?: string
  ) {
    return this.requireLifecycle().runRuntime(
      providerId,
      operation,
      undefined,
      undefined,
      version
    );
  }

  async runRaw<T = unknown>(
    providerId: string,
    operation: MemoryRuntimeOperation,
    values?: Record<string, string>,
    version?: string
  ) {
    return this.require(providerId).run(operation, values, version) as Promise<T>;
  }

  listVersions(providerId: string) {
    return this.requireLifecycle().listRuntimeVersions(providerId);
  }

  writeConfig(
    providerId: string,
    values: Record<string, string>,
    authorityToken?: string
  ) {
    return this.requireLifecycle().runRuntime(
      providerId,
      "config-write",
      values,
      authorityToken
    );
  }

  previewConfig(providerId: string, values: Record<string, string>) {
    return this.requireLifecycle().previewRuntimeConfig(providerId, values);
  }

  previewConfigIssue(issue: MemoryConfigIssue, action: MemoryConfigIssueAction) {
    return this.requireLifecycle().previewRuntimeConfigIssue(issue, action);
  }

  requestConfigAuthority(
    providerId: string,
    values: Record<string, string>,
    previewDigest: string
  ) {
    return this.requireLifecycle().requestRuntimeConfigAuthority(
      providerId,
      values,
      previewDigest
    );
  }

  requestConfigIssueAuthority(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction,
    previewDigest: string
  ) {
    return this.requireLifecycle().requestRuntimeConfigIssueAuthority(
      issue,
      action,
      previewDigest
    );
  }

  resolveConfigIssue(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction,
    authorityToken?: string
  ) {
    const coordinator = this.require(issue.providerId);
    if (!coordinator.hasConfigIssue(issue)) {
      throw new Error("NO_ACTIVE_CONFIG_ISSUE: 当前没有匹配的配置问题");
    }
    return this.requireLifecycle().resolveRuntimeConfigIssue(
      issue,
      action,
      authorityToken
    );
  }

  /* IPC 只注册一次：旧实现每个 installer 各注册一遍 handler，
     第二个实例注册时必然抛「重复 handler」——单点注册后这个
     失败模式直接消失。registrar 可注入，让「经通道打进来的输入」
     能在纯 Node 里被真正打一遍，而不是绕过通道直调业务方法。 */
  register(
    window: BrowserWindow,
    rendererUrl: string,
    registrar: RendererIpcRegistrar = rendererIpc
  ) {
    this.window = window;
    registrar(window, rendererUrl, "拒绝非主窗口的 Memory 请求")
      .handle(MEMORY_CHANNEL.runtimeGet, (raw) =>
        this.snapshot(assertProviderId(raw))
      )
      .handle(MEMORY_CHANNEL.runtimeRefresh, (raw) =>
        this.refresh(assertProviderId(raw))
      )
      .handle(MEMORY_CHANNEL.runtimeCheckUpdates, (raw) => {
        const input = assertObject(raw);
        if (typeof input.force !== "boolean") {
          throw new Error("Memory 版本检查参数无效");
        }
        return this.require(assertProviderId(input.providerId)).checkUpdates(
          input.force
        );
      })
      .handle(MEMORY_CHANNEL.runtimeVersions, (raw) =>
        this.listVersions(assertProviderId(raw))
      )
      .handle(MEMORY_CHANNEL.runtimeRun, (raw) => {
        const input = assertObject(raw);
        const operation = assertMemoryRuntimeRendererCommand(input.operation);
        return this.run(
          assertProviderId(input.providerId),
          operation,
          typeof input.version === "string" ? input.version : undefined
        );
      })
      .handle(MEMORY_CHANNEL.runtimeConfig, (raw) => {
        const input = assertObject(raw);
        return this.writeConfig(
          assertProviderId(input.providerId),
          assertValues(input.values),
          assertOptionalAuthorityToken(input.authorityToken)
        );
      })
      .handle(MEMORY_CHANNEL.runtimeConfigPreview, (raw) => {
        const input = assertObject(raw);
        const providerId = assertProviderId(input.providerId);
        const mutation = assertConfigMutation(input.mutation);
        assertMutationProvider(providerId, mutation);
        return mutation.kind === "write"
          ? this.previewConfig(providerId, mutation.values)
          : this.previewConfigIssue(mutation.issue, mutation.action);
      })
      .handle(MEMORY_CHANNEL.runtimeConfigAuthority, (raw) => {
        const input = assertObject(raw);
        const providerId = assertProviderId(input.providerId);
        const mutation = assertConfigMutation(input.mutation);
        assertMutationProvider(providerId, mutation);
        const digest = assertDigest(input.previewDigest);
        return mutation.kind === "write"
          ? this.requestConfigAuthority(providerId, mutation.values, digest)
          : this.requestConfigIssueAuthority(
              mutation.issue,
              mutation.action,
              digest
            );
      })
      .handle(MEMORY_CHANNEL.resolveConfigIssue, (raw) => {
        const input = assertObject(raw);
        return this.resolveConfigIssue(
          assertConfigIssue(input.issue),
          assertConfigIssueAction(input.action),
          assertOptionalAuthorityToken(input.authorityToken)
        );
      })
      .handle(MEMORY_CHANNEL.requestDestructiveAuthority, (raw) => {
        const input = assertObject(raw);
        return this.requireLifecycle().requestDestructiveAuthority(
          assertProviderId(input.providerId),
          assertMemoryDestructiveOperation(input.operation)
        );
      })
      .handle(MEMORY_CHANNEL.consumeDestructiveAuthority, (raw) => {
        if (typeof raw !== "string" || raw.length > 256) {
          throw new Error("Memory 破坏性授权无效");
        }
        return this.requireLifecycle().consumeDestructiveAuthority(raw);
      });
    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  private publish(snapshot: MemoryRuntimeSnapshot) {
    const current = this.publishedRevision.get(snapshot.providerId) ?? -1;
    if (snapshot.revision < current) return;
    this.publishedRevision.set(snapshot.providerId, snapshot.revision);
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    try {
      window.webContents.send(MEMORY_CHANNEL.runtimeState, snapshot);
    } catch (cause) {
      console.warn("[memory] runtime state publish failed", cause);
    }
  }

  private requireLifecycle() {
    if (!this.lifecycle) throw new Error("Memory 生命周期编排器尚未初始化");
    return this.lifecycle;
  }
}

function assertConfigIssue(value: unknown): MemoryConfigIssue {
  const input = assertObject(value);
  const text = (key: string, pattern: RegExp) => {
    const item = input[key];
    if (typeof item !== "string" || !pattern.test(item)) {
      throw new Error("Memory 配置问题参数无效");
    }
    return item;
  };
  return {
    providerId: assertProviderId(input.providerId),
    instanceId: text("instanceId", /^[a-f0-9]{32}$/),
    file: text("file", /^[A-Za-z0-9._-]{1,255}$/),
    expectedHash: text("expectedHash", /^[a-f0-9]{64}$/),
    actualHash: text("actualHash", /^[a-f0-9]{64}$/),
  };
}

function assertConfigIssueAction(value: unknown): MemoryConfigIssueAction {
  if (value !== "regenerate" && value !== "adopt-manual") {
    throw new Error("Memory 配置问题动作无效");
  }
  return value;
}

function assertConfigMutation(value: unknown): MemoryRuntimeConfigMutation {
  const input = assertObject(value);
  if (input.kind === "write") {
    return { kind: "write", values: assertValues(input.values) };
  }
  if (input.kind === "resolve-issue") {
    return {
      kind: "resolve-issue",
      issue: assertConfigIssue(input.issue),
      action: assertConfigIssueAction(input.action),
    };
  }
  throw new Error("Memory 配置变更参数无效");
}

function assertMutationProvider(
  providerId: string,
  mutation: MemoryRuntimeConfigMutation
) {
  if (
    mutation.kind === "resolve-issue" &&
    mutation.issue.providerId !== providerId
  ) throw new Error("Memory 配置问题与 provider 不匹配");
}

export function assertMemoryRuntimeRendererCommand(
  value: unknown
): MemoryRuntimeRendererCommand {
  if (!RENDERER_COMMANDS.includes(value as MemoryRuntimeRendererCommand)) {
    throw new Error("未知或无权执行的运行时操作");
  }
  return value as MemoryRuntimeRendererCommand;
}

export function assertMemoryDestructiveOperation(
  value: unknown
): MemoryDestructiveOperation {
  if (!DESTRUCTIVE_OPERATIONS.includes(value as MemoryDestructiveOperation)) {
    throw new Error("未知的破坏性 Memory 操作");
  }
  return value as MemoryDestructiveOperation;
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory 运行时参数无效");
  }
  return value as Record<string, unknown>;
}

function assertProviderId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9-]{1,64}$/.test(value)) {
    throw new Error("Memory provider id 无效");
  }
  return value;
}

function assertOptionalAuthorityToken(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^memory_config_[a-f0-9]{32}$/.test(value)) {
    throw new Error("Memory 配置授权无效");
  }
  return value;
}

function assertDigest(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Memory 配置预览摘要无效");
  }
  return value;
}

/* 密钥是不可信输入里最危险的一种：只接受扁平的字符串字典，
   长度硬上限，绝不透传对象——它最终会进 plist 或受管配置文件。 */
function assertValues(value: unknown): Record<string, string> {
  const raw = assertObject(value);
  const entries = Object.entries(raw);
  if (entries.length > 16) throw new Error("Memory 配置字段过多");
  return Object.fromEntries(
    entries.map(([key, item]) => {
      if (!/^[A-Z0-9_]{1,64}$/.test(key) || typeof item !== "string") {
        throw new Error(`Memory 配置字段无效：${key}`);
      }
      if (item.length > 4_096) throw new Error(`Memory 配置字段过长：${key}`);
      return [key, item];
    })
  );
}
