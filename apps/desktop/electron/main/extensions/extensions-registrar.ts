/**
 * [INPUT]: Depends on rendererIpc, ExtensionRegistryStore/ExtensionInstaller/ExtensionDisableConvergence/ExtensionPackageUninstall and shared renderer-safe extension DTO
 * [OUTPUT]: Provides registerExtensions: installing, component symmetry activation, packing, packing/unloading 11 IPCs and changing the broadcast
 * [POS]: The extension of the renderer boundary; The real path and the internal structure of admission are projected here and never come off
 */

import type { BrowserWindow } from "electron";
import {
  EXTENSIONS_CHANNEL,
  type ExtensionPreflightView,
  type ExtensionsSnapshot,
  type Sha256Digest,
} from "../../../shared/extensions-ipc";
import { rendererIpc } from "../ipc-registrar";
import type { ExtensionInstaller, ExtensionInstallPreflight } from "./install/installer";
import type { ExtensionDisableConvergence } from "./lifecycle/disable-convergence";
import type { ExtensionPackageUninstall } from "./lifecycle/package-uninstall";
import type { ExtensionRegistryStore } from "./registry-store";
import { buildExtensionCapabilitySnapshot } from "./capability-snapshot";
import {
  backendExtensionProbe,
  EXTENSION_PRODUCT_POLICY,
} from "./product-policy";
import type { AgentBackendId } from "../../../shared/agent-ipc";

const SETTINGS_BACKENDS: readonly AgentBackendId[] = [
  "codex",
  "claude",
  "kimi",
  "opencode",
];

export type ExtensionsRegistrarDependencies = {
  registry: ExtensionRegistryStore;
  installer: ExtensionInstaller;
  convergence: ExtensionDisableConvergence;
  uninstall: ExtensionPackageUninstall;
  /* 启用/停用/安装都会改变 `$` 面板候选集；不失效就要等 TTL 才看得见。 */
  onChanged: () => void;
};

export function registerExtensions(
  window: BrowserWindow,
  rendererUrl: string,
  deps: ExtensionsRegistrarDependencies
) {
  const publish = async () => {
    deps.onChanged();
    const value = await projectSnapshot(deps);
    window.webContents.send(EXTENSIONS_CHANNEL.changed, value);
    return value;
  };
  rendererIpc(window, rendererUrl, "拒绝非主窗口的扩展请求")
    .handle(EXTENSIONS_CHANNEL.list, () => projectSnapshot(deps))
    .handle(EXTENSIONS_CHANNEL.preflight, async (raw) =>
      projectPreflight(await deps.installer.preflight(assertPreflightInput(raw)))
    )
    .handle(EXTENSIONS_CHANNEL.confirm, async (raw) => {
      await deps.installer.confirm(assertConfirmInput(raw));
      return publish();
    })
    .handle(EXTENSIONS_CHANNEL.discard, (raw) =>
      deps.installer.discard(assertString(raw, "preflightId"))
    )
    .handle(EXTENSIONS_CHANNEL.enableComponent, async (raw) => {
      await deps.registry.enableComponent(assertString(raw, "componentIdentity"));
      return publish();
    })
    .handle(EXTENSIONS_CHANNEL.disableComponent, async (raw) => {
      await deps.registry.disableComponent(assertString(raw, "componentIdentity"));
      return publish();
    })
    /* deny 与三道闸（新计划 / 新 projection binding / 新产品会话）在提交这一刻
       生效，随后才是可重试的四步收敛。收敛没走完就停在 disable-pending——
       状态里那句话是真的，不是占位。 */
    .handle(EXTENSIONS_CHANNEL.beginDisable, async (raw) => {
      await deps.convergence.beginDisable(assertString(raw, "installIdentity"));
      return publish();
    })
    /* 卸载的第一次调用只做两件事：关闸、把还欠着的 durable 引用摆出来。真正
       的删除要等用户把那些引用解决掉，所以这里从不「顺便就删了」。 */
    .handle(EXTENSIONS_CHANNEL.beginUninstall, async (raw) => {
      await deps.uninstall.begin(assertString(raw, "installIdentity"));
      return publish();
    })
    .handle(EXTENSIONS_CHANNEL.resolveUninstall, async (raw) => {
      const input = assertObject(raw, "扩展卸载参数");
      await deps.uninstall.resolve({
        installIdentity: assertString(input.installIdentity, "installIdentity"),
        migrateAppIds: assertStringArray(input.migrateAppIds, "migrateAppIds"),
      });
      return publish();
    })
    .handle(EXTENSIONS_CHANNEL.cancelUninstall, async (raw) => {
      await deps.uninstall.cancel(assertString(raw, "installIdentity"));
      return publish();
    })
    /* 数据删除单独一条命令，且永远不由卸载顺手调用：package 代码回收与「丢掉
       这个安装的全部历史」不该共用一个按钮。 */
    .handle(EXTENSIONS_CHANNEL.purgeInstallData, async (raw) => {
      await deps.uninstall.purgeInstallData(assertString(raw, "installIdentity"));
      return publish();
    });
}

async function projectSnapshot(
  deps: ExtensionsRegistrarDependencies
): Promise<ExtensionsSnapshot> {
  const inventory = deps.registry.snapshot();
  const capability = SETTINGS_BACKENDS.map((backendId) =>
    buildExtensionCapabilitySnapshot({
      inventory,
      probe: backendExtensionProbe(
        backendId,
        `${backendId}:settings-unversioned`,
        "unversioned"
      ),
      policy: EXTENSION_PRODUCT_POLICY,
    })
  );
  const packages = [];
  for (const item of inventory.packages) {
    const enabled = new Set(item.enabledComponentIdentities);
    const activeId = item.activeGenerationRef?.packageGenerationId;
    const activeGeneration = item.generations.find(
      (generation) => generation.packageGenerationId === activeId
    );
    packages.push({
      installIdentity: item.installIdentity,
      adapterId: activeGeneration?.admissionEvidence.adapterId ?? "unknown",
      displayName:
        activeGeneration?.displayName ??
        item.source.normalizedUrl.replace(/^https:\/\/github\.com\//, ""),
      admission: item.admission,
      administrativeState: item.administrativeState,
      globalCatalogEnabled: item.globalCatalogEnabled,
      enabled: item.enabled,
      source: {
        normalizedUrl: item.source.normalizedUrl,
        resolvedCommit: item.source.resolvedCommit,
        subdirectory: item.source.subdirectory,
        fetchedAt: item.source.fetchedAt,
      },
      activeGenerationId: activeId ?? null,
      components: inventory.components
        .filter(
          (component) =>
            component.packageGenerationRef.packageGenerationId === activeId
        )
        .map((component) => ({
          componentIdentity: component.componentIdentity,
          componentId: component.componentId,
          kind: component.kind,
          transport: component.transport,
          enabled: enabled.has(component.componentIdentity),
          eligibility: capability.map((snapshot) => {
            const entry = snapshot.entries.find(
              (value) => value.componentIdentity === component.componentIdentity
            )!;
            return {
              backendId: snapshot.backendId,
              channel: component.transport,
              eligible: entry.eligible,
              strength: entry.deliveryStrength,
              ...(entry.exclusion ? { exclusionCode: entry.exclusion.code } : {}),
            };
          }),
          /* M3 健康账本未供给前，无观察只能是 unknown。 */
          deliveryHealth: SETTINGS_BACKENDS.map((backendId) => ({
            backendId,
            channel: component.transport,
            status: "unknown" as const,
          })),
        })),
      /* 旧代不是垃圾：仍被精确绑定时保持不可变可寻址，UI 必须能看见它们。 */
      retainedGenerations: item.generations
        .filter((generation) => generation.packageGenerationId !== activeId)
        .map((generation) => ({
          generationId: generation.packageGenerationId,
          resolvedCommit:
            deps.registry.generationSource(generation.packageGenerationId)
              ?.resolvedCommit ?? "",
          blockerCount: deps.registry.blockers({
            packageGenerationId: generation.packageGenerationId,
            recordDigest: generation.recordDigest,
          }).length,
        })),
      foreignOccupancies: deps.convergence.foreignOccupanciesOf(
        item.installIdentity
      ),
      convergence: deps.convergence.convergenceOf(item.installIdentity),
      uninstall: await deps.uninstall.viewOf(item.installIdentity),
    });
  }
  return {
    packages,
    productSessionAdmissionClosed: deps.convergence.productSessionAdmissionClosed(),
    /* 包没了、数据还在，是必须一直看得见的状态：藏起来就等于宣称卸载已经
       「什么都没剩下」，而下次装同一个仓库时那份旧数据会原样回来。 */
    retainedInstallData: await deps.uninstall.retainedInstallData(),
  };
}

function projectPreflight(
  preflight: ExtensionInstallPreflight
): ExtensionPreflightView {
  return {
    preflightId: preflight.preflightId,
    contentDigest: preflight.contentDigest,
    componentNamespace: preflight.componentNamespace,
    installIdentity: preflight.installIdentity,
    adapterId: preflight.adapterId,
    source: {
      normalizedUrl: preflight.source.normalizedUrl,
      requestedRef: preflight.source.requestedRef,
      resolvedCommit: preflight.source.resolvedCommit,
      subdirectory: preflight.source.subdirectory,
    },
    disclosure: preflight.disclosure,
    reports: preflight.admission.diagnostics
      .filter((item) => item.severity === "report")
      .map((item) => `${item.path}：${item.message}`),
    fileCount: preflight.files.length,
    totalBytes: preflight.files.reduce((sum, file) => sum + file.bytes, 0),
    capabilityDiff: preflight.capabilityDiff,
    affectedApps: preflight.affectedApps,
  };
}

function assertPreflightInput(raw: unknown) {
  const input = assertObject(raw, "扩展预检参数");
  return {
    repoUrl: assertString(input.repoUrl, "repoUrl"),
    ...(input.requestedRef === undefined
      ? {}
      : { requestedRef: assertString(input.requestedRef, "requestedRef") }),
    ...(input.subdirectory === undefined
      ? {}
      : { subdirectory: assertString(input.subdirectory, "subdirectory") }),
  };
}

function assertConfirmInput(raw: unknown) {
  const input = assertObject(raw, "扩展确认参数");
  const digest = assertString(input.expectedContentDigest, "expectedContentDigest");
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("contentDigest 格式无效");
  return {
    preflightId: assertString(input.preflightId, "preflightId"),
    expectedContentDigest: digest as Sha256Digest,
    expectedResolvedCommit: assertString(
      input.expectedResolvedCommit,
      "expectedResolvedCommit"
    ),
    migrateAppIds: assertStringArray(input.migrateAppIds, "migrateAppIds"),
  };
}

function assertObject(raw: unknown, label: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}无效`);
  }
  return raw as Record<string, unknown>;
}

function assertString(raw: unknown, field: string) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${field} 无效`);
  return raw;
}

function assertStringArray(raw: unknown, field: string) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${field} 无效`);
  return raw.map((item) => assertString(item, field));
}
