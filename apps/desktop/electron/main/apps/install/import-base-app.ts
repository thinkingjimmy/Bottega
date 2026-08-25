/**
 * [INPUT]: Depends on freeze packages directory/plugin preflight, strict manifest/base snapshot, App/Project/Base store, Extension installer, AppConfigStore and lifecycle gate
 * [OUTPUT]: Provides BaseAppImporter import/recover/retryPending/cancelPending; Fulfillment Failed to enter retest mode, canceled with a cleaner, such as a durable marker, and replaced after all plugins have been performed
 * [POS]: The basic delivery pipeline for apps/install; GitHub is different from the default only on "Where the package comes from", delivering, restoring and finishing zero copies
 */

import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AppConfigValue,
  AppExtensionInstallPreflight,
  AppRecord,
  AppRequirement,
} from "../../../../shared/apps-ipc";
import { baseSnapshotFileSchema } from "../../../../shared/base-snapshot";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { BaseStore } from "../../bases/base-store";
import { projectOwnerIdentity } from "../../bases/base-store";
import type { BasesService } from "../../bases/bases-service";
import type { AdmissionGate, SagaResult } from "../../lifecycle/admission-gate";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import type { ProjectsService } from "../../projects/projects-service";
import type { AppStore } from "../app-store";
import {
  AppConfigStore,
  validateConfigRequirements,
} from "../share/app-config-store";
import { detectCliRequirements } from "../share/cli-detectors";
import { inspectPackage, packageDigest } from "../share/package-contract";
import { appManifestSchema } from "./manifest-schema";
import { digestCanonical } from "../../extensions/registry-store";
import type { ExtensionInstaller } from "../../extensions/install/installer";

/**
 * 包的来源。`github` 记来源仓库、`preset` 不记——AppRecord.origin 与
 * sourceRepoUrl 由这一个字段推导，交付段因此没有一处来源分支。
 */
export type ImportSource = {
  origin: "github" | "preset";
  /** github：归一化仓库地址；preset：canonical presetId。 */
  ref: string;
  digest: string;
  packageRoot: string;
  extensionPreflights?: readonly AppExtensionInstallPreflight[];
  preset?: {
    presetId: string;
    resolvedPin: string;
    channel: "release" | "dev";
  };
};

/** intent kind 按来源分家（契约 v3）：预设安装与远端导入的恢复面互不污染。 */
const INTENT_KIND = {
  github: "base-import",
  preset: "preset-install",
} as const;

type ImportRequest = {
  requestId: string;
  source: ImportSource;
  agent: AgentBackendId;
  config: AppConfigValue;
};

export class BaseAppImporter {
  private extensions: Pick<
    ExtensionInstaller,
    "preflight" | "confirm" | "discard" | "isInstalled"
  > | null = null;
  constructor(
    private readonly apps: AppStore,
    private readonly projects: ProjectsService,
    private readonly bases: BasesService,
    private readonly baseStore: BaseStore,
    private readonly configs: AppConfigStore,
    private readonly intents: LifecycleIntentStore,
    private readonly gate: AdmissionGate,
    private readonly publish: (record: AppRecord) => void,
    /** 测试缝：required CLI 门禁默认走真探测器，注入假探测即可密封验证。 */
    private readonly detectCli: typeof detectCliRequirements = detectCliRequirements
  ) {}

  configureExtensions(port: Pick<
    ExtensionInstaller,
    "preflight" | "confirm" | "discard" | "isInstalled"
  >) {
    if (this.extensions) throw new Error("Base App fulfillment 已配置");
    this.extensions = port;
  }

  async import(request: ImportRequest) {
    await this.configs.stagePending(request.requestId, request.config);
    let outcome;
    try {
      outcome = await this.gate.admitAndRun<AppRecord>(
        {
          kind: INTENT_KIND[request.source.origin],
          requestId: request.requestId,
          input: {
            origin: request.source.origin,
            sourceRef: request.source.ref,
            confirmedDigest: request.source.digest,
            packageRoot: request.source.packageRoot,
            agent: request.agent,
            extensionFulfillment: fulfillmentInput(request.source.extensionPreflights),
            consentIntent: Boolean(request.source.extensionPreflights?.length),
            ...(request.source.preset ?? {}),
          },
          allocate: () => ({
            appId: createId("a"),
            projectId: createId("p"),
          }),
        },
        (intent) => this.execute(intent, request)
      );
    } catch (cause) {
      // 409 = 这笔 requestId 未入 journal（仲裁拒绝/入参冲突）：
      // pending 配置含 secret 值，没有任何恢复会来消费它，必须立刻清
      if ((cause as { status?: number }).status === 409) {
        await this.configs
          .removePending(request.requestId)
          .catch(() => undefined);
      }
      throw cause;
    }
    // 终态重放（done 返 receipt / rolled-back 原样上抛）：pending 配置不是物证
    if (outcome.state === "settled") {
      await this.configs
        .removePending(request.requestId)
        .catch(() => undefined);
    }
    if (
      outcome.state === "executed" &&
      outcome.result.status === "done" &&
      outcome.result.value
    ) {
      return outcome.result.value;
    }
    if (outcome.state === "settled" && outcome.status === "done") {
      const appId = String(outcome.receipt?.appId ?? "");
      const record = this.apps.get(appId);
      if (record) return record;
    }
    if (
      outcome.state === "executed" &&
      outcome.result.status === "business-rejected"
    ) {
      throw new Error(outcome.result.error.message);
    }
    throw new Error(
      outcome.state === "settled"
        ? outcome.error?.message
        : "Base App 交付未完成"
    );
  }

  recover(intent: LifecycleIntent) {
    return this.execute(intent, null);
  }

  async hasPending(appId: string) {
    return Boolean(await this.pendingImport(appId));
  }

  async retryPending(appId: string) {
    const pending = await this.pendingImport(appId);
    if (!pending) throw new Error("App 没有可恢复的安装事务");
    const outcome = await this.gate.runRecovery(pending.intentId, async (intent) => {
      if (intent.recoveryState.cancelRequested === true) {
        return this.cancelIntent(intent);
      }
      const current = this.apps.get(appId);
      if (!current || current.manifest || current.generationBinding.active) {
        return {
          status: "business-rejected",
          error: { code: "IMPORT_STATE_DRIFT", message: "App 安装恢复状态已漂移" },
        } as const;
      }
      const retrying = await this.apps.update(appId, (record) => ({
        ...record,
        state: "creating",
        lastError: null,
        agentWarning: null,
      }));
      this.publish(retrying);
      return this.execute(intent, null);
    });
    const record = this.apps.get(appId);
    if (outcome.state === "recovered" && outcome.result.status === "done" && record) {
      return record;
    }
    throw new Error(
      record?.lastError?.message ??
        (outcome.state === "recovered" && outcome.result.status === "business-rejected"
          ? outcome.result.error.message
          : "App 安装恢复未完成")
    );
  }

  async cancelPending(appId: string) {
    const pending = await this.pendingImport(appId);
    if (!pending) return false;
    if (pending.phase !== "delivered") {
      throw new Error("Base 数据已开始提交，当前阶段不能取消，只能继续恢复");
    }
    const outcome = await this.gate.runRecovery(pending.intentId, async (intent) => {
      const marked = await this.intents.advance(intent.intentId, intent.phase, {
        cancelRequested: true,
      });
      return this.cancelIntent(marked);
    });
    return outcome.state === "recovered" &&
      outcome.result.status === "business-rejected" &&
      outcome.result.error.code === "USER_CANCELLED";
  }

  private async execute(
    intent: LifecycleIntent,
    request: ImportRequest | null
  ): Promise<SagaResult<AppRecord>> {
    const appId = String(intent.allocated.appId);
    const projectId = String(intent.allocated.projectId);
    const finalDir = join(this.apps.appsRoot, appId);
    let record = this.apps.get(appId);

    if (intent.recoveryState.cancelRequested === true) {
      return this.cancelIntent(intent);
    }

    /* "delivered" 是准入首档(arbitrate 即推进)；交付与否的唯一判据是
     * finalDir 是否存在——rename 原子落地即证据，崩溃恢复据此跳过重交付。 */
    if (intent.phase === "delivered") {
      const delivered = await access(finalDir).then(
        () => true,
        () => false
      );
      if (!delivered) {
        const result = await this.deliver(intent, request, appId, finalDir);
        if (result) return result;
        record = this.apps.get(appId);
      }
      await this.configs.removePending(intent.requestId);
      record ??= this.apps.get(appId);
      if (!record) return { status: "interrupted" };
      await this.projects.ensureForAppHeld(appId, projectId);
      await this.intents.advance(intent.intentId, "project-ensured");
      intent = (await this.intents.getById(intent.intentId))!;
    }
    if (intent.phase === "project-ensured") {
      const snapshot = baseSnapshotFileSchema.parse(
        JSON.parse(
          await readFile(join(finalDir, "data", "base.json"), "utf8")
        )
      );
      await this.baseStore.ensure(projectOwnerIdentity(projectId, snapshot.name));
      const ownerKey = `project:${projectId}`;
      await this.bases.importJson(
        ownerKey,
        snapshot,
        await this.bases.issueSystemMutationAuthority(ownerKey, "json-import")
      );
      await this.intents.advance(intent.intentId, "base-seeded");
      intent = (await this.intents.getById(intent.intentId))!;
    }
    if (intent.phase === "base-seeded") {
      /* base.json 只是灌注载体：数据已入 Base，运行目录不留陈旧副本（包契约「运行时不存在」）。 */
      await rm(join(finalDir, "data"), { recursive: true, force: true });
      const saved = await this.apps.update(appId, (current) => ({
        ...current,
        state: "ready",
      }));
      this.publish(saved);
      return {
        status: "done",
        value: saved,
        receipt: { appId, projectId, sourceRepoUrl: saved.sourceRepoUrl },
      };
    }
    return { status: "interrupted" };
  }

  /** delivered 档：包错误终结；fulfillment 失败保持冻结物证并返回 interrupted。 */
  private async deliver(
    intent: LifecycleIntent,
    request: ImportRequest | null,
    appId: string,
    finalDir: string
  ): Promise<SagaResult<AppRecord> | null> {
    const packageRoot = String(
      request?.source.packageRoot ?? intent.input.packageRoot
    );
    const reject = async (code: string, message: string) => {
      await rm(dirname(packageRoot), { recursive: true, force: true });
      await this.configs.removePending(intent.requestId);
      return {
        status: "business-rejected",
        error: { code, message },
      } as const;
    };

    const validated = await this.validatePackage(intent, request, packageRoot)
      .then((value) => ({ ok: true as const, value }))
      .catch((cause: unknown) => ({
        ok: false as const,
        message: cause instanceof Error ? cause.message : "冻结包校验失败",
      }));
    /* 冻结包/配置证据不完整时不留 pending 僵尸：settle 为失败终态，重试须重新 preflight。 */
    if (!validated.ok) return reject("INVALID_PACKAGE", validated.message);
    const { activeRequest, manifest } = validated.value;
    if (manifest.kind !== "base") {
      return reject("NOT_BASE_APP", "冻结包不是 Base App");
    }
    const cli = await this.detectCli(manifest.requirements?.tools ?? []);
    const missing = cli.find((status) => {
      const requirement = manifest.requirements?.tools.find(
        (item) => item.id === status.id
      );
      return requirement?.required && status.detectable && !status.installed;
    });
    if (missing) {
      return reject("REQUIREMENT_MISSING", `缺少必需 CLI：${missing.id}`);
    }

    const { origin, ref } = activeRequest.source;
    let record = this.apps.get(appId);
    if (!record) {
      await this.apps.reserveId(appId);
      /* shell 只投影「这笔安装存在」，不携带 manifest，因而绝不提前成代。 */
      record = await this.apps.set({
        id: appId,
        sourceRepoUrl: origin === "github" ? ref : null,
        publishedRepoUrl: null,
        origin,
        ...(activeRequest.source.preset
          ? {
              presetId: activeRequest.source.preset.presetId,
              installedPresetPin: activeRequest.source.preset.resolvedPin,
            }
          : {}),
        displayName: manifest.name,
        dir: finalDir,
        state: "creating",
        lastError: null,
        agentWarning: null,
        agent: activeRequest.agent,
        maintenanceAgent: activeRequest.agent,
        headlessConsent: null,
        bindingRevision: 0,
        lifecycleRevision: 0,
        defaultGrant: null,
        defaultGrantRevision: 0,
        domainIdentity: null,
        generations: [],
        generationBinding: {
          bindingRevision: 0,
          active: null,
          drainingGenerationIds: [],
        },
        manifest: null,
        editChatSlot: null,
        activeUseChatSlot: null,
        skillStatus: null,
        addedAt: Date.now(),
      });
    }
    const fulfillment = await this.fulfillExtensions(
      intent,
      activeRequest.source.extensionPreflights ?? []
    );
    if (!fulfillment.complete) {
      record = await this.apps.update(appId, (current) => ({
        ...current,
        state: "install-failed",
        lastError: {
          phase: "install",
          message: `插件兑现失败：${fulfillment.error}`.slice(0, 3_500),
        },
        agentWarning: `插件待处理：${fulfillment.error}`.slice(0, 3_500),
      }));
      this.publish(record);
      return { status: "interrupted" };
    }
    /* fulfillment 全部 checkpoint 后才提交 manifest；AppStore 此刻才允许成代。 */
    record = await this.apps.set(
      {
        ...record,
        state: "creating",
        lastError: null,
        agentWarning: null,
        manifest,
      },
      { generationSourceDir: packageRoot }
    );
    const declarations = manifest.extensionRequirements ?? [];
    const canAutoConsent = fulfillment.complete &&
      intent.input.consentIntent === true &&
      declarations.length === (activeRequest.source.extensionPreflights?.length ?? 0);
    if (record.generationBinding.pending && canAutoConsent) {
      record = await this.apps.resolvePendingConsent(appId, true);
      record = await this.apps.promotePendingGeneration(
        appId,
        record.generationBinding.pending!.expectedConsentRevision
      );
    }
    if (declarations.length > 0 && !canAutoConsent) {
      record = await this.apps.update(appId, (current) => ({
        ...current,
        agentWarning: "插件待处理：缺少可自动安装的 source",
      }));
    }
    await this.configs.write(
      appId,
      activeRequest.config,
      manifest.requirements?.tools ?? []
    );
    await rm(finalDir, { recursive: true, force: true });
    /* rename 即交付的原子证据；此后崩溃，恢复以 finalDir 存在为准跳过重交付。 */
    await rename(packageRoot, finalDir);
    await makeWritable(finalDir);
    await rm(dirname(packageRoot), { recursive: true, force: true });
    this.publish(record);
    return null;
  }

  /** 校验冻结包并还原请求；任何解析/断言失败向上抛，由 deliver 统一 settle。 */
  private async validatePackage(
    intent: LifecycleIntent,
    request: ImportRequest | null,
    packageRoot: string
  ) {
    const activeRequest: ImportRequest =
      request ?? {
        requestId: intent.requestId,
        source: {
          origin: intent.input.origin === "preset" ? "preset" : "github",
          ref: String(intent.input.sourceRef),
          digest: String(intent.input.confirmedDigest),
          packageRoot,
          extensionPreflights: fulfillmentFromIntent(intent),
          ...(intent.input.origin === "preset"
            ? {
                preset: {
                  presetId: String(intent.input.presetId),
                  resolvedPin: String(intent.input.resolvedPin),
                  channel: intent.input.channel as "release" | "dev",
                },
              }
            : {}),
        },
        agent: intent.input.agent as AgentBackendId,
        config: await this.configs.readPending(intent.requestId),
      };
    /* digest 复核对真实字节：交付（含崩溃恢复重入）拿到的必须就是用户在
     * preflight 确认的那份包——staging 在窗口期被换内容/植 symlink 都在这里
     * fail-closed（inspectPackage 拒 symlink，指纹不符即拒）。 */
    const inspection = await inspectPackage(packageRoot);
    const digest = await packageDigest(packageRoot, inspection.files);
    if (digest !== activeRequest.source.digest) {
      throw new Error("冻结包内容与确认摘要不一致，已拒绝交付");
    }
    const manifest = appManifestSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "app.json"), "utf8"))
    );
    baseSnapshotFileSchema.parse(
      JSON.parse(
        await readFile(join(packageRoot, "data", "base.json"), "utf8")
      )
    );
    assertRequirements(manifest.requirements?.tools ?? [], activeRequest.config);
    validateConfigRequirements(manifest.requirements?.tools ?? []);
    return { activeRequest, manifest };
  }

  private async fulfillExtensions(
    intent: LifecycleIntent,
    initial: readonly AppExtensionInstallPreflight[]
  ) {
    const expected = fulfillmentFromIntent(intent);
    if (!expected.length) return { complete: true, error: "" };
    if (!this.extensions) {
      return this.fulfillmentFailed(intent, "插件安装服务未初始化");
    }
    const extensions = this.extensions;
    const completed = new Set(
      Array.isArray(intent.recoveryState.fulfilledExtensions)
        ? intent.recoveryState.fulfilledExtensions.filter(
            (value): value is string => typeof value === "string"
          )
        : []
    );
    try {
      for (const item of expected) {
        if (completed.has(item.componentIdentity)) continue;
        const held = initial.find(
          (candidate) =>
            candidate.componentIdentity === item.componentIdentity &&
            candidate.preflightId
        );
        if (extensions.isInstalled(item)) {
          if (held?.preflightId) await extensions.discard(held.preflightId);
          completed.add(item.componentIdentity);
          intent = await this.intents.advance(intent.intentId, intent.phase, {
            fulfilledExtensions: [...completed].sort(),
          });
          continue;
        }
        let preflight = held;
        if (!preflight) {
          const value = await extensions.preflight({
            repoUrl: item.repoUrl,
            requestedRef: item.resolvedCommit,
          });
          preflight = {
            componentIdentity: item.componentIdentity,
            repoUrl: value.source.normalizedUrl,
            requestedRef: value.source.requestedRef,
            resolvedCommit: value.source.resolvedCommit,
            contentDigest: value.contentDigest,
            capabilityDigest: digestCanonical(value.disclosure),
            capabilities: value.disclosure,
            preflightId: value.preflightId,
            state: "ready",
          };
        }
        if (
          preflight.contentDigest !== item.contentDigest ||
          preflight.capabilityDigest !== item.capabilityDigest ||
          preflight.resolvedCommit !== item.resolvedCommit
        ) {
          throw new Error(`插件冻结身份漂移：${item.componentIdentity}`);
        }
        await extensions.confirm({
          preflightId: preflight.preflightId!,
          expectedContentDigest: item.contentDigest,
          expectedResolvedCommit: item.resolvedCommit,
        });
        completed.add(item.componentIdentity);
        intent = await this.intents.advance(intent.intentId, intent.phase, {
          fulfilledExtensions: [...completed].sort(),
        });
      }
      await this.intents.advance(intent.intentId, intent.phase, {
        extensionFulfillmentError: null,
      });
      return { complete: true, error: "" };
    } catch (cause) {
      await Promise.allSettled(
        initial.flatMap((item) =>
          item.preflightId && !completed.has(item.componentIdentity)
            ? [extensions.discard(item.preflightId)]
            : []
        )
      );
      return this.fulfillmentFailed(
        intent,
        cause instanceof Error ? cause.message : String(cause)
      );
    }
  }

  private async fulfillmentFailed(intent: LifecycleIntent, error: string) {
    await this.intents.advance(intent.intentId, intent.phase, {
      extensionFulfillmentError: error.slice(0, 3_500),
    });
    return { complete: false as const, error };
  }

  private async pendingImport(appId: string) {
    return (await this.intents.listPending()).find(
      (intent) =>
        (intent.kind === "base-import" || intent.kind === "preset-install") &&
        intent.allocated.appId === appId
    );
  }

  /**
   * cancelRequested 先入 intent 再清物证；任一步崩溃，启动恢复都会重新进入这里。
   * 已兑现的 Extension 是共享内容寻址库存，不在取消 App 时猜测性卸载。
   */
  private async cancelIntent(intent: LifecycleIntent): Promise<SagaResult<AppRecord>> {
    if (intent.phase !== "delivered") return { status: "interrupted" };
    const appId = String(intent.allocated.appId);
    const packageRoot = String(intent.input.packageRoot);
    const record = this.apps.get(appId);
    if (record?.manifest || record?.generationBinding.active) {
      return {
        status: "business-rejected",
        error: { code: "CANCEL_TOO_LATE", message: "App 已经成代，不能再按安装取消" },
      };
    }
    await this.configs.removePending(intent.requestId);
    await rm(dirname(packageRoot), { recursive: true, force: true });
    await rm(join(this.apps.appsRoot, appId), { recursive: true, force: true });
    await this.apps.remove(appId);
    return {
      status: "business-rejected",
      error: { code: "USER_CANCELLED", message: "用户取消安装" },
    };
  }
}

function fulfillmentInput(
  preflights: readonly AppExtensionInstallPreflight[] | undefined
) {
  return (preflights ?? []).map(({ capabilities: _capabilities, preflightId: _id, state: _state, ...item }) => item);
}

function fulfillmentFromIntent(
  intent: LifecycleIntent
): AppExtensionInstallPreflight[] {
  const rows = Array.isArray(intent.input.extensionFulfillment)
    ? intent.input.extensionFulfillment
    : [];
  return rows.map((value) => ({
    ...(value as Omit<AppExtensionInstallPreflight, "capabilities" | "preflightId" | "state">),
    capabilities: {
      executableScripts: [],
      skills: [],
      mcpServers: [],
      requiresPluginDataWriteRoot: false,
    },
    preflightId: null,
    state: "ready",
  }));
}

function assertRequirements(
  requirements: readonly AppRequirement[],
  config: AppConfigValue
) {
  for (const requirement of requirements) {
    if (
      requirement.kind === "config" &&
      requirement.required &&
      (!requirement.configKey || !config.values[requirement.configKey]?.trim())
    ) {
      throw new Error(`必填配置未填写：${requirement.label}`);
    }
  }
}

function createId(prefix: string) {
  return `${prefix}${randomUUID().replaceAll("-", "").slice(0, 9)}`;
}

async function makeWritable(directory: string): Promise<void> {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await makeWritable(path);
    else await chmod(path, 0o600);
  }
}
