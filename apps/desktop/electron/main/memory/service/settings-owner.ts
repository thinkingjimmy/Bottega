/**
 * [INPUT]: Depends on SettingsStore v11 Memory target resolver ManagedRuntimeRegistry with Consent capability for binding sharing mode/generation
 * [OUTPUT]: Provides MemorySettingsOwner: sequential persistence and compensation enable/cutover/pause/three-level shared range mutation, and credible disabling and forward retesting
 * [POS]: The main/memory/service settings.memory is the only entry; The renderer's intent and lifecycle convergence must be met through it
 */

import type {
  MemoryEffectiveTarget,
} from "../../../../shared/memory-ipc";
import type {
  MemorySharingMode,
  MemorySettings,
  MemorySettingsMutation,
  SettingsEnvelope,
} from "../../../../shared/settings-ipc";
import { SerialQueue } from "../../persistence/serial-queue";
import type { SettingsStore } from "../../settings-store";
import { requireMemoryModule } from "../providers/registry";
import type { ManagedRuntimeRegistry } from "../runtime/managed-registry";
import { resolveMemoryTarget } from "../core/target";

const RETRY_DELAY_MS = 5_000;

export type MemorySettingsOwnerDependencies = {
  settings: SettingsStore;
  runtimes: ManagedRuntimeRegistry;
  /** 把磁盘上的意图变成 runtime 事实；失败即保留 pending 并前向重试。 */
  apply(target: MemoryEffectiveTarget, memory: MemorySettings): Promise<void>;
  /** 一次性 main authority 必须与即将提交的目标 instance 完全一致。 */
  consumeConsentAuthority(
    token: string,
    target: MemoryEffectiveTarget,
    purpose?: "live" | "configuration"
  ): Promise<void>;
  pause(): Promise<void>;
  resume(target: MemoryEffectiveTarget, sharingMode: MemorySharingMode): Promise<void>;
  /** disable 是撤销边：Consent Epoch 必须在关闭时刻闭合，否则关闭窗口会被
      未来 rebuild 重建成已授权历史。实现必须幂等（无可撤内容时零写入）。 */
  revokeConsentForDisable(providerId: string): Promise<void>;
  /** rebuild 活跃期间冻结 provider 变更（四 owner 生命周期互锁）。 */
  rebuildActive(): boolean;
  /** Settings queue 只观测外层 lifecycle reservation，绝不反向 acquire。 */
  lifecycleHeld?(providerId: string): boolean;
  retryDelayMs?: number;
};

export class MemorySettingsOwner {
  private readonly queue = new SerialQueue();
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly dependencies: MemorySettingsOwnerDependencies) {}

  /* ============================================================
   * 四条 mutation 是 renderer 唯一能对 memory 说的话。通用
   * settings:set 已在类型与运行时双重拒绝 memory——「任何守护都能
   * 被绕过」的旧形状在这里彻底关门。
   * ============================================================ */
  mutate(mutation: MemorySettingsMutation): Promise<SettingsEnvelope> {
    return this.queue.enqueue(async () => {
      const current = this.dependencies.settings.get().memory;
      if (
        mutation.kind === "set-sharing-with-consent" &&
        mutation.sharingMode === current.sharingMode
      ) {
        return this.dependencies.settings.envelope();
      }
      const prepared = await this.prepare(current, mutation);
      if (prepared.next.enabled && !prepared.target.canEnable) {
        throw new Error(
          prepared.target.blockedReason ?? "当前目标不可用，无法启用长期记忆"
        );
      }
      const pending = await this.dependencies.settings.setMemoryTrusted({
        ...prepared.next,
        pendingRevision: null,
        applyStatus: { state: "pending", message: null, at: Date.now() },
      });
      try {
        await prepared.commitPolicy();
      } catch (cause) {
        await this.compensateSettings(current, cause);
        throw cause;
      }
      return this.applyAndSettle(prepared.target, pending);
    });
  }

  /** orchestrator 已持外层锁，直接落禁用意图；不重入 mutation/apply。 */
  disableProviderTrusted(providerId: string): Promise<SettingsEnvelope> {
    return this.queue.enqueue(async () => {
      const current = this.dependencies.settings.get().memory;
      if (current.provider !== providerId || !current.enabled) {
        return this.dependencies.settings.envelope();
      }
      /* revoke 先于 Settings 落盘：撤销失败在此刻炸给 orchestrator 重试
         （enabled 仍 true，重入会再走到这里）；半途崩溃时「已撤未关」是
         安全侧（admission 见不到 Consent），而「已关未撤」会把关闭窗口
         留成可被 rebuild 重建的伪授权区间。 */
      await this.dependencies.revokeConsentForDisable(providerId);
      return this.dependencies.settings.setMemoryTrusted({
        ...current,
        enabled: false,
        paused: false,
        pendingRevision: null,
        applyStatus: { state: "pending", message: null, at: Date.now() },
      });
    });
  }

  reapply(providerId: string) {
    return this.queue.enqueue(async () => {
      const envelope = this.dependencies.settings.envelope();
      const memory = envelope.settings.memory;
      if (memory.provider !== providerId) return envelope;
      const target = await this.resolveTarget(memory);
      return this.applyAndSettle(target, envelope);
    });
  }

  async resolveTarget(memory = this.dependencies.settings.get().memory) {
    const descriptor = requireMemoryModule(memory.provider).descriptor;
    const coordinator = this.dependencies.runtimes.get(memory.provider);
    const manifest = (await coordinator?.manifest()) ?? null;
    const ownershipValid = coordinator
      ? await coordinator.ownershipValid(manifest)
      : null;
    let runtime: { installed: boolean; configured: boolean } | null = null;
    if (coordinator) {
      const snapshot = await coordinator.snapshot();
      runtime = {
        installed: snapshot.installed,
        configured: snapshot.configured,
      };
    }
    return resolveMemoryTarget({
      descriptor,
      manifest,
      ownershipValid,
      runtime,
    });
  }

  /** 前向重试：磁盘新、runtime 旧的窗口必须自己收敛，不能等用户再点一次。 */
  scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retryApply();
    }, this.dependencies.retryDelayMs ?? RETRY_DELAY_MS);
    this.retryTimer.unref?.();
  }

  retryApply(): Promise<SettingsEnvelope | null> {
    return this.queue.enqueue(async () => {
      const envelope = this.dependencies.settings.envelope();
      const state = envelope.settings.memory.applyStatus?.state;
      if (state !== "failed" && state !== "pending") return null;
      const target = await this.resolveTarget(envelope.settings.memory);
      return this.applyAndSettle(target, envelope);
    });
  }

  dispose() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async applyAndSettle(
    target: MemoryEffectiveTarget,
    pending: SettingsEnvelope
  ): Promise<SettingsEnvelope> {
    try {
      await this.dependencies.apply(target, pending.settings.memory);
      const settled = await this.dependencies.settings.setMemoryTrusted({
        ...this.dependencies.settings.get().memory,
        pendingRevision: null,
        applyStatus: null,
      });
      return settled;
    } catch (cause) {
      const message = "Memory 配置暂未生效，将自动重试";
      this.scheduleRetry();
      try {
        return await this.dependencies.settings.setMemoryTrusted({
          ...this.dependencies.settings.get().memory,
          pendingRevision: pending.revision,
          applyStatus: { state: "failed", message, at: Date.now() },
        });
      } catch {
        /* retry 已先武装；保留原 apply/persist 异常，不制造第二个失败面。 */
        throw cause;
      }
    }
  }

  private async prepare(
    current: MemorySettings,
    mutation: MemorySettingsMutation
  ) {
    switch (mutation.kind) {
      case "cutover-with-consent": {
        this.assertMutable("切换记忆后端");
        this.assertLifecycleFree(current.provider, "切换记忆后端");
        this.assertLifecycleFree(mutation.providerId, "切换记忆后端");
        requireMemoryModule(mutation.providerId);
        const candidate = await this.resolveTarget({
          ...current,
          provider: mutation.providerId,
        });
        if (!candidate.canEnable) {
          throw new Error(candidate.blockedReason ?? "目标服务尚不可用");
        }
        return {
          next: {
            ...current,
            provider: mutation.providerId,
            enabled: true,
            paused: false,
          },
          target: candidate,
          commitPolicy: () => this.dependencies.consumeConsentAuthority(
            mutation.authorityToken,
            candidate
          ),
        };
      }
      case "enable-with-consent": {
        this.assertMutable("启用长期记忆");
        this.assertLifecycleFree(current.provider, "启用长期记忆");
        const target = await this.resolveTarget(current);
        const runtime = this.dependencies.runtimes.get(current.provider);
        const snapshot = runtime ? await runtime.snapshot() : null;
        if (snapshot?.installed && !snapshot.configured) {
          throw new Error("运行时尚未完成配置，暂不能启用长期记忆");
        }
        return {
          next: { ...current, enabled: true, paused: false },
          target,
          commitPolicy: () => this.dependencies.consumeConsentAuthority(
            mutation.authorityToken,
            target
          ),
        };
      }
      case "set-paused": {
        if (!current.enabled) throw new Error("长期记忆尚未启用");
        const target = await this.resolveTarget(current);
        const unchanged = mutation.paused === current.paused;
        return {
          next: unchanged ? current : { ...current, paused: mutation.paused },
          target,
          commitPolicy: unchanged
            ? async () => {}
            : mutation.paused
              ? () => this.dependencies.pause()
              : () => this.dependencies.resume(target, current.sharingMode),
        };
      }
      case "set-sharing-with-consent": {
        if (!current.enabled) throw new Error("长期记忆尚未启用");
        this.assertMutable("修改记忆共享范围");
        this.assertLifecycleFree(current.provider, "修改记忆共享范围");
        const target = await this.resolveTarget(current);
        return {
          next: { ...current, sharingMode: mutation.sharingMode },
          target,
          commitPolicy: () =>
            this.dependencies.consumeConsentAuthority(
              mutation.authorityToken,
              target,
              current.paused ? "configuration" : "live"
            ),
        };
      }
      default: {
        const exhaustive: never = mutation;
        throw new Error(`未知的 Memory mutation：${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private async compensateSettings(current: MemorySettings, cause: unknown) {
    try {
      await this.dependencies.settings.setMemoryTrusted(current);
    } catch {
      /* Policy commit 失败时 runtime 仍是旧态；保留原异常，避免补偿错误伪装根因。 */
      throw cause;
    }
  }

  private assertMutable(action: string) {
    if (this.dependencies.rebuildActive()) {
      throw new Error(`记忆正在重建，${action}已暂时冻结`);
    }
  }

  private assertLifecycleFree(providerId: string, action: string) {
    if (this.dependencies.lifecycleHeld?.(providerId)) {
      throw new Error(`该后端正在执行安装/重建/卸载，${action}请稍后`);
    }
  }

}

export function assertMemoryMutation(value: unknown): MemorySettingsMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory 设置指令无效");
  }
  const input = value as Record<string, unknown>;
  switch (input.kind) {
    case "enable-with-consent":
      if (typeof input.authorityToken !== "string") break;
      return { kind: "enable-with-consent", authorityToken: input.authorityToken };
    case "cutover-with-consent":
      if (
        typeof input.providerId !== "string" ||
        typeof input.authorityToken !== "string"
      ) break;
      return {
        kind: "cutover-with-consent",
        providerId: input.providerId,
        authorityToken: input.authorityToken,
      };
    case "set-paused":
      if (typeof input.paused !== "boolean") break;
      return { kind: "set-paused", paused: input.paused };
    case "set-sharing-with-consent":
      if (
        (input.sharingMode !== "chat" &&
          input.sharingMode !== "group" &&
          input.sharingMode !== "personal") ||
        typeof input.authorityToken !== "string"
      ) break;
      return {
        kind: "set-sharing-with-consent",
        sharingMode: input.sharingMode,
        authorityToken: input.authorityToken,
      };
    default:
      break;
  }
  throw new Error("Memory 设置指令无效");
}
