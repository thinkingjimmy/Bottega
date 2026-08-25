/**
 * [INPUT]: Depends on crypto, ManagedRuntimeRegistry/Coordinator, Settings Owner and MemoryService provided current Consent destination/active/quiesce/reopen/reapply/rebuild fresh
 * [OUTPUT]: Provides MemoryLifecycle Orchestrator: per-provider reservation, revision-only version directory, coordinator direct, not running time queue, mirror/semi-installation recovery, credible version switching, configuration capability, disruption of the operation matrix and single enclosure sequence
 * [POS]: The destructive lifecycle center of main/memory/runtime/control; Coordinator is original, Settings/Delivery is not allowed to reverse to get reservation
 */

import { randomUUID } from "node:crypto";
import type {
  MemoryConfigIssue,
  MemoryConfigIssueAction,
  MemoryDestructiveAuthority,
  MemoryDestructiveOperation,
  MemoryRuntimeConfigAuthority,
  MemoryRuntimeConfigPreview,
  MemoryRuntimeSnapshot,
} from "../../../../../shared/memory-ipc";
import { stableMemoryDigest } from "../../turn-deadline";
import type { MemorySettingsOwner } from "../../service/settings-owner";
import type { ManagedRuntimeRegistry } from "../managed-registry";

const AUTHORITY_TTL_MS = 30_000;

type LifecycleOperation =
  | "install"
  | "repair"
  | "upgrade"
  | "switch-version"
  | "config-write"
  | "config-regenerate"
  | "config-adopt-manual"
  | MemoryDestructiveOperation;

type AuthorityRecord = MemoryDestructiveAuthority & {
  /** uninstall 绑定 managed instance；rebuild 绑定 effective fingerprint。 */
  identity: string | null;
};

type Authorization = {
  proceed: boolean;
  identity: string | null;
};

type ConfigMutation =
  | Readonly<{ kind: "write"; values: Record<string, string> }>
  | Readonly<{
      kind: "issue";
      issue: MemoryConfigIssue;
      action: MemoryConfigIssueAction;
    }>;

type ConfigAuthorityRecord = MemoryRuntimeConfigAuthority & {
  mutationDigest: string;
};

export type MemoryLifecycleDependencies = {
  runtimes: ManagedRuntimeRegistry;
  settings: MemorySettingsOwner;
  activeProvider(): string;
  activeMemory(): Readonly<{ provider: string; enabled: boolean }>;
  consentDestination(
    providerId: string,
    providerDataInstanceId: string
  ): Promise<{ hostname: string; model: string } | null>;
  quiesce(): Promise<void>;
  reopen(): Promise<void> | void;
  authorizeRebuild(providerId: string): Promise<string>;
  rebuild(providerId: string): Promise<void>;
  reconcileRuntimeConfig(
    preview: MemoryRuntimeConfigPreview,
    confirmed: boolean
  ): Promise<void>;
  terminalPublish(providerId: string): Promise<void> | void;
};

export class MemoryLifecycleOrchestrator {
  private readonly held = new Set<string>();
  private readonly authorities = new Map<string, AuthorityRecord>();
  private readonly configAuthorities = new Map<
    string,
    ConfigAuthorityRecord
  >();

  constructor(private readonly dependencies: MemoryLifecycleDependencies) {}

  isHeld(providerId: string) {
    return this.held.has(providerId);
  }

  async requestDestructiveAuthority(
    providerId: string,
    operation: MemoryDestructiveOperation
  ): Promise<MemoryDestructiveAuthority> {
    const authorization = await this.authorize(operation, providerId);
    this.pruneAuthorities(providerId, operation);
    const authority: AuthorityRecord = {
      token: `memory_auth_${randomUUID().replaceAll("-", "")}`,
      providerId,
      operation,
      identity: authorization.identity,
      expiresAt: Date.now() + AUTHORITY_TTL_MS,
    };
    this.authorities.set(authority.token, authority);
    return {
      token: authority.token,
      providerId,
      operation,
      expiresAt: authority.expiresAt,
    };
  }

  async consumeDestructiveAuthority(token: string) {
    this.pruneAuthorities();
    const authority = this.authorities.get(token);
    this.authorities.delete(token);
    if (!authority || authority.expiresAt <= Date.now()) {
      throw new Error("Memory 破坏性授权无效或已过期");
    }
    const authorization = await this.authorize(
      authority.operation,
      authority.providerId
    );
    if (authorization.identity !== authority.identity) {
      throw new Error("Memory 运行时或目标地址已变化，请重新确认");
    }
    if (authority.operation === "rebuild") {
      await this.runRebuild(authority.providerId);
    } else {
      await this.run(authority.providerId, authority.operation);
    }
  }

  runRebuild(providerId: string, action?: () => Promise<void>) {
    return this.run(providerId, "rebuild", undefined, action);
  }

  /* 目录是只读的，走 coordinator 直连而不是运行时串行队列——排队只会
     把 phase 打成 running。reservation 仍然要拿：它保证「这份目录」与
     返回的 revision 属于同一个运行时事实，也挡住列表刚取完就被切版的
     竞态；它不改 phase，面板照常可用。 */
  async listRuntimeVersions(providerId: string) {
    this.acquire(providerId);
    try {
      const catalog = await this.dependencies.runtimes
        .require(providerId)
        .versions();
      const runtime = await this.dependencies.runtimes.snapshot(providerId);
      return { providerId, revision: runtime.revision, ...catalog };
    } finally {
      this.held.delete(providerId);
    }
  }

  runRuntime(
    providerId: string,
    operation: Exclude<LifecycleOperation, MemoryDestructiveOperation>,
    values?: Record<string, string>,
    authorityToken?: string,
    version?: string
  ): Promise<MemoryRuntimeSnapshot> {
    return this.run(
      providerId,
      operation,
      values,
      undefined,
      authorityToken,
      undefined,
      version
    ).then(() =>
      this.dependencies.runtimes.snapshot(providerId)
    );
  }

  async previewRuntimeConfig(
    providerId: string,
    values: Record<string, string>
  ): Promise<MemoryRuntimeConfigPreview> {
    const coordinator = this.dependencies.runtimes.require(providerId);
    const [current, next] = await Promise.all([
      coordinator.extractionDestination(),
      coordinator.previewExtractionDestination(values),
    ]);
    return this.buildConfigPreview(providerId, current, next);
  }

  async previewRuntimeConfigIssue(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction
  ) {
    const coordinator = this.dependencies.runtimes.require(issue.providerId);
    if (!coordinator.hasConfigIssue(issue)) {
      throw new Error("NO_ACTIVE_CONFIG_ISSUE: 当前没有匹配的配置问题");
    }
    const [current, next] = await Promise.all([
      coordinator.extractionDestination(),
      coordinator.previewConfigIssueDestination(issue, action),
    ]);
    return this.buildConfigPreview(issue.providerId, current, next);
  }

  private async buildConfigPreview(
    providerId: string,
    diskDestination: { hostname: string; model: string } | null,
    next: { hostname: string; model: string }
  ): Promise<MemoryRuntimeConfigPreview> {
    const runtime = await this.dependencies.runtimes.snapshot(providerId);
    if (!runtime.providerDataInstanceId) {
      throw new Error("Memory provider instance 尚未建立");
    }
    const active = this.dependencies.activeMemory();
    const comparesActiveConsent = active.enabled && active.provider === providerId;
    const consent = comparesActiveConsent
      ? await this.dependencies.consentDestination(
          providerId,
          runtime.providerDataInstanceId
        )
      : null;
    if (comparesActiveConsent && !consent) {
      throw new Error("Memory 当前目的地没有有效 Consent，保持隔离");
    }
    const currentDestination = consent ?? diskDestination ?? next;
    const hostnameChanged = currentDestination.hostname !== next.hostname;
    const modelChanged = currentDestination.model !== next.model;
    const change = hostnameChanged && modelChanged
      ? "hostname-and-model"
      : hostnameChanged
        ? "hostname"
        : modelChanged
          ? "model"
          : "none";
    const base = {
      providerId,
      providerDataInstanceId: runtime.providerDataInstanceId,
      currentHostname: currentDestination.hostname,
      currentModel: currentDestination.model,
      nextHostname: next.hostname,
      nextModel: next.model,
      change,
      requiresConfirmation:
        comparesActiveConsent && hostnameChanged,
    } as const;
    return Object.freeze({ ...base, digest: stableMemoryDigest(base) });
  }

  async requestRuntimeConfigAuthority(
    providerId: string,
    values: Record<string, string>,
    previewDigest: string
  ): Promise<MemoryRuntimeConfigAuthority> {
    return this.requestConfigAuthority(
      providerId,
      { kind: "write", values },
      previewDigest
    );
  }

  requestRuntimeConfigIssueAuthority(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction,
    previewDigest: string
  ) {
    return this.requestConfigAuthority(
      issue.providerId,
      { kind: "issue", issue, action },
      previewDigest
    );
  }

  private async requestConfigAuthority(
    providerId: string,
    mutation: ConfigMutation,
    previewDigest: string
  ): Promise<MemoryRuntimeConfigAuthority> {
    const preview = await this.previewConfigMutation(providerId, mutation);
    if (!preview.requiresConfirmation || preview.digest !== previewDigest) {
      throw new Error("Memory 配置目的地预览已变化，请重新确认");
    }
    this.pruneConfigAuthorities(providerId);
    const authority = Object.freeze({
      token: `memory_config_${randomUUID().replaceAll("-", "")}`,
      preview,
      expiresAt: Date.now() + AUTHORITY_TTL_MS,
      mutationDigest: stableMemoryDigest(mutation),
    });
    this.configAuthorities.set(authority.token, authority);
    return {
      token: authority.token,
      preview: authority.preview,
      expiresAt: authority.expiresAt,
    };
  }

  resolveRuntimeConfigIssue(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction,
    authorityToken?: string
  ) {
    return this.run(
      issue.providerId,
      action === "regenerate" ? "config-regenerate" : "config-adopt-manual",
      undefined,
      undefined,
      authorityToken,
      { kind: "issue", issue, action }
    ).then(() => this.dependencies.runtimes.snapshot(issue.providerId));
  }

  async refreshRuntime(providerId: string) {
    this.acquire(providerId);
    try {
      const snapshot = await this.dependencies.runtimes
        .require(providerId)
        .refreshReachability();
      const active = this.dependencies.activeMemory();
      let destinationFailure: unknown = null;
      if (active.enabled && active.provider === providerId) {
        try {
          const actual = await this.dependencies.runtimes
            .require(providerId)
            .extractionDestination();
          const consent = snapshot.providerDataInstanceId
            ? await this.dependencies.consentDestination(
                providerId,
                snapshot.providerDataInstanceId
              )
            : null;
          if (
            !actual ||
            !consent ||
            actual.hostname !== consent.hostname ||
            actual.model !== consent.model
          ) destinationFailure = new Error(
            "Memory 实际提取目的地与 Consent 不一致，已保持隔离；请重新提交配置确认"
          );
        } catch (cause) {
          destinationFailure = cause;
        }
        if (snapshot.configIssue || destinationFailure) {
          await this.dependencies.quiesce();
        }
      }
      await this.dependencies.terminalPublish(providerId);
      if (destinationFailure && !snapshot.configIssue) throw destinationFailure;
      return snapshot;
    } finally {
      this.held.delete(providerId);
    }
  }

  private async run(
    providerId: string,
    operation: LifecycleOperation,
    values?: Record<string, string>,
    rebuildAction?: () => Promise<void>,
    configAuthorityToken?: string,
    configMutation?: ConfigMutation,
    runtimeVersion?: string
  ) {
    this.acquire(providerId);
    const affectsActive = providerId === this.dependencies.activeProvider();
    let primary: unknown = null;
    let convergence: unknown = null;
    let authorized = false;
    let quiesced = false;
    let safeToReopen = true;
    let configPreview: MemoryRuntimeConfigPreview | null = null;
    let configConfirmed = false;
    try {
      authorized = (await this.authorize(operation, providerId)).proceed;
      if (!authorized) return;
      const mutation = configMutation ?? (
        operation === "config-write"
          ? { kind: "write" as const, values: values ?? {} }
          : null
      );
      if (mutation) {
        configPreview = await this.previewConfigMutation(providerId, mutation);
        configConfirmed = this.consumeConfigAuthority(
          configPreview,
          mutation,
          configAuthorityToken
        );
      }
      if (operation === "uninstall" && affectsActive) {
        await this.dependencies.settings.disableProviderTrusted(providerId);
      }
      if (affectsActive) {
        await this.dependencies.quiesce();
        quiesced = true;
      }
      if (operation === "rebuild") {
        await (rebuildAction ?? (() => this.dependencies.rebuild(providerId)))();
      } else {
        if (
          configPreview &&
          this.requiresConsentEpoch(configPreview)
        ) safeToReopen = false;
        await this.dependencies.runtimes.runRaw(
          providerId,
          operation,
          values,
          runtimeVersion
        );
        if (configPreview && this.requiresConsentEpoch(configPreview)) {
          const actual = await this.dependencies.runtimes
            .require(providerId)
            .extractionDestination();
          if (
            !actual ||
            actual.hostname !== configPreview.nextHostname ||
            actual.model !== configPreview.nextModel
          ) {
            throw new Error("Memory 配置落盘目的地与已确认预览不一致");
          }
          await this.dependencies.reconcileRuntimeConfig(
            configPreview,
            configConfirmed
          );
          safeToReopen = true;
        }
      }
    } catch (cause) {
      primary = cause;
    } finally {
      try {
        if (authorized) {
          const issue = (await this.dependencies.runtimes.snapshot(providerId))
            .configIssue;
          if (quiesced && safeToReopen && !issue) {
            await this.dependencies.reopen();
          }
          await this.dependencies.settings.reapply(providerId);
        }
      } catch (cause) {
        convergence = cause;
      }
      try {
        const coordinator = this.dependencies.runtimes.get(providerId);
        if (coordinator) await coordinator.terminalSnapshot();
        await this.dependencies.terminalPublish(providerId);
      } catch (cause) {
        convergence ??= cause;
      } finally {
        this.held.delete(providerId);
      }
    }
    if (primary) throw primary;
    if (convergence) throw convergence;
  }

  private acquire(providerId: string) {
    if (this.held.has(providerId)) {
      throw new Error("该后端正在执行安装/重建/卸载，请稍后");
    }
    this.held.add(providerId);
  }

  private pruneAuthorities(
    providerId?: string,
    operation?: MemoryDestructiveOperation
  ) {
    const now = Date.now();
    for (const [token, authority] of this.authorities) {
      const superseded =
        authority.providerId === providerId && authority.operation === operation;
      if (authority.expiresAt < now || superseded) {
        this.authorities.delete(token);
      }
    }
  }

  private requiresConsentEpoch(preview: MemoryRuntimeConfigPreview) {
    const active = this.dependencies.activeMemory();
    return (
      active.enabled &&
      active.provider === preview.providerId &&
      preview.change !== "none"
    );
  }

  private consumeConfigAuthority(
    preview: MemoryRuntimeConfigPreview,
    mutation: ConfigMutation,
    token?: string
  ) {
    this.pruneConfigAuthorities();
    if (!preview.requiresConfirmation) return false;
    const authority = token ? this.configAuthorities.get(token) : undefined;
    if (token) this.configAuthorities.delete(token);
    if (
      !authority ||
      authority.expiresAt <= Date.now() ||
      authority.preview.digest !== preview.digest ||
      authority.mutationDigest !== stableMemoryDigest(mutation)
    ) {
      throw new Error("提取 hostname 变化必须重新确认目的地");
    }
    return true;
  }

  private pruneConfigAuthorities(providerId?: string) {
    const now = Date.now();
    for (const [token, authority] of this.configAuthorities) {
      if (
        authority.expiresAt < now ||
        authority.preview.providerId === providerId
      ) this.configAuthorities.delete(token);
    }
  }

  private previewConfigMutation(providerId: string, mutation: ConfigMutation) {
    if (mutation.kind === "write") {
      return this.previewRuntimeConfig(providerId, mutation.values);
    }
    return this.previewRuntimeConfigIssue(mutation.issue, mutation.action);
  }

  private async authorize(operation: LifecycleOperation, providerId: string) {
    if (operation === "rebuild") {
      return {
        proceed: true,
        identity: await this.dependencies.authorizeRebuild(providerId),
      } satisfies Authorization;
    }
    const coordinator = this.dependencies.runtimes.require(providerId);
    let manifest = await coordinator.manifest();
    const ownership = await coordinator.ownershipValid(manifest);
    const marker = manifest
      ? null
      : await coordinator.roots?.readMarker?.() ?? null;
    if (operation === "uninstall" && !manifest) {
      return { proceed: true, identity: null } satisfies Authorization;
    }
    if (operation === "install") {
      if (ownership === false) throw new Error("托管目录归属不匹配，拒绝安装覆盖");
      if (marker) throw new Error("检测到原安装身份，请使用修复恢复 manifest");
      if (manifest) throw new Error("运行时已经安装，请使用修复或升级");
      return { proceed: true, identity: null } satisfies Authorization;
    }
    if (operation === "repair" && !manifest && marker) {
      manifest = await coordinator.recoverManifestFromMarker(marker);
    }
    if (!manifest) throw new Error(`未找到托管安装，无法执行 ${operation}`);
    if (operation === "repair" && ownership !== false) {
      return {
        proceed: true,
        identity: manifest.instanceId,
      } satisfies Authorization;
    }
    if (ownership !== true) throw new Error("托管目录归属校验失败");
    if (
      operation === "config-write" &&
      !(await this.dependencies.runtimes.snapshot(providerId)).installed
    ) {
      throw new Error("托管运行时未完整安装，无法写入配置");
    }
    return {
      proceed: true,
      identity: manifest.instanceId,
    } satisfies Authorization;
  }
}
