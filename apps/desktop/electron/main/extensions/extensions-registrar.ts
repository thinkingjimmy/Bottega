/**
 * [INPUT]: Depends on rendererIpc, Project lifecycle authority, scoped Extension owners, and diagnostic AgentPluginInventory
 * [OUTPUT]: Provides scope-aware Extension IPC v2, exact-owner CAS validation, renderer-safe owned snapshots, and independently isolated revision-only invalidation fan-out
 * [POS]: Main-only renderer boundary; scope filtering and Project incarnation checks finish before any lifecycle mutation or DTO projection
 */

import type { BrowserWindow } from "electron";
import {
  assertExtensionDigestIdentity,
  EXTENSIONS_CHANNEL,
  type ExtensionComponentRecord,
  type ExtensionPreflightView,
  type ExtensionScopeMutation,
  type ExtensionScopeQuery,
  type ExtensionsChangedEvent,
  type ExtensionsSnapshot,
  type Sha256Digest,
} from "../../../shared/extensions-ipc";
import {
  assertProductResourceScope,
  type ProductResourceScope,
} from "../../../shared/product-resource-scope";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { rendererIpc } from "../ipc-registrar";
import type { ProjectsService } from "../projects/projects-service";
import type {
  ExtensionInstaller,
  ExtensionInstallPreflight,
} from "./install/installer";
import type { ExtensionDisableConvergence } from "./lifecycle/disable-convergence";
import type { ExtensionPackageUninstall } from "./lifecycle/package-uninstall";
import type { ExtensionRegistryStore } from "./registry-store";
import { buildExtensionCapabilitySnapshot } from "./capability-snapshot";
import {
  backendExtensionProbe,
  EXTENSION_PRODUCT_POLICY,
} from "./product-policy";
import type { AgentPluginInventory } from "./agent-plugin-inventory";

const SETTINGS_BACKENDS: readonly AgentBackendId[] = [
  "codex",
  "claude",
  "kimi",
  "opencode",
];

export function isRendererVisibleExtensionComponent(
  component: Pick<ExtensionComponentRecord, "kind">
) {
  return component.kind === "skill" || component.kind === "mcp-server";
}

export type ExtensionsRegistrarDependencies = {
  registry: ExtensionRegistryStore;
  installer: ExtensionInstaller;
  convergence: ExtensionDisableConvergence;
  uninstall: ExtensionPackageUninstall;
  agentPlugins: AgentPluginInventory;
  projects: Pick<ProjectsService, "store" | "getProjectLifecycleRevision">;
  onChanged: (scope: ProductResourceScope) => void;
};

export function registerExtensions(
  window: BrowserWindow,
  rendererUrl: string,
  deps: ExtensionsRegistrarDependencies
) {
  const sendInvalidation = (event: {
    scope: ProductResourceScope;
    scopeRevision: number;
  }) => {
    publishExtensionInvalidation(event, {
      onChanged: deps.onChanged,
      projectLifecycleRevision: (projectId) =>
        deps.projects.getProjectLifecycleRevision(projectId) ?? null,
      send: (value) =>
        window.webContents.send(EXTENSIONS_CHANNEL.changed, value),
    });
  };
  const unsubscribe = deps.registry.onInventoryChanged(sendInvalidation);
  window.once("closed", unsubscribe);

  const snapshot = (query: ExtensionScopeQuery) => projectSnapshot(deps, query);
  rendererIpc(window, rendererUrl, "拒绝非主窗口的扩展请求")
    .roles("main")
    .handle(EXTENSIONS_CHANNEL.list, (raw) =>
      snapshot(assertExtensionQuery(raw, deps))
    )
    .handle(EXTENSIONS_CHANNEL.preflight, async (raw) => {
      const input = assertExtensionPreflightInput(raw, deps);
      return projectPreflight(await deps.installer.preflight(input));
    })
    .handle(EXTENSIONS_CHANNEL.confirm, async (raw) => {
      const input = assertExtensionConfirmInput(raw);
      const held = deps.installer.heldAuthorization(input.preflightId);
      if (!held) throw conflict("扩展预检已失效");
      assertAuthority(
        {
          scope: held.scope,
          expectedProjectLifecycleRevision: held.projectLifecycleRevision,
        },
        deps
      );
      await deps.installer.confirm(input);
      return snapshot({
        scope: held.scope,
        expectedProjectLifecycleRevision: held.projectLifecycleRevision,
      });
    })
    .handle(EXTENSIONS_CHANNEL.discard, (raw) =>
      deps.installer.discard(assertString(raw, "preflightId"))
    )
    .handle(EXTENSIONS_CHANNEL.beginDisable, async (raw) => {
      const input = assertExtensionMutation(raw, deps);
      await deps.convergence.beginDisable(input);
      return snapshot(queryOf(input));
    })
    .handle(EXTENSIONS_CHANNEL.beginUninstall, async (raw) => {
      const input = assertExtensionMutation(raw, deps);
      await deps.uninstall.begin(input);
      return snapshot(queryOf(input));
    })
    .handle(EXTENSIONS_CHANNEL.resolveUninstall, async (raw) => {
      const object = assertObject(raw, "扩展卸载参数");
      const input = assertExtensionMutation(object, deps, ["migrateAppIds"]);
      await deps.uninstall.resolve({
        ...input,
        migrateAppIds: assertStringArray(object.migrateAppIds, "migrateAppIds"),
      });
      return snapshot(queryOf(input));
    })
    .handle(EXTENSIONS_CHANNEL.cancelUninstall, async (raw) => {
      const input = assertExtensionMutation(raw, deps);
      await deps.uninstall.cancel(input);
      return snapshot(queryOf(input));
    })
    .handle(EXTENSIONS_CHANNEL.purgeInstallData, async (raw) => {
      const input = assertExtensionMutation(raw, deps);
      await deps.uninstall.purgeInstallData(input);
      return snapshot(queryOf(input));
    })
    /* Diagnostic/L1-only data plane. The renderer bridge exposes no control and
       the primary Extensions UI never consumes agentPlugins. */
    .handle(EXTENSIONS_CHANNEL.setAgentPluginEnabled, async (raw) => {
      const input = assertObject(raw, "Agent Plugin 参数");
      if (input.backendId !== "claude" || typeof input.enabled !== "boolean") {
        throw new Error("仅 Claude 支持产品内逐项启停");
      }
      await deps.agentPlugins.setClaudeEnabled(
        assertString(input.pluginId, "pluginId"),
        input.enabled
      );
      const query = {
        scope: { kind: "global" } as const,
        expectedProjectLifecycleRevision: null,
      };
      return snapshot(query);
    });
}

export function publishExtensionInvalidation(
  event: Readonly<{ scope: ProductResourceScope; scopeRevision: number }>,
  consumers: Readonly<{
    onChanged(scope: ProductResourceScope): void;
    projectLifecycleRevision(projectId: string): number | null;
    send(value: ExtensionsChangedEvent): void;
  }>
) {
  try {
    consumers.onChanged(event.scope);
  } catch (cause) {
    console.warn("[extensions] internal invalidation consumer failed", cause);
  }
  let projectLifecycleRevision: number | null = null;
  if (event.scope.kind === "project") {
    try {
      projectLifecycleRevision = consumers.projectLifecycleRevision(
        event.scope.projectId
      );
    } catch (cause) {
      console.warn("[extensions] Project invalidation authority failed", cause);
    }
  }
  try {
    consumers.send({ ...event, projectLifecycleRevision });
  } catch (cause) {
    console.warn("[extensions] renderer invalidation delivery failed", cause);
  }
}

async function projectSnapshot(
  deps: ExtensionsRegistrarDependencies,
  query: ExtensionScopeQuery
): Promise<ExtensionsSnapshot> {
  assertAuthority(query, deps);
  const inventory = deps.registry.ownedInventory(
    query.scope,
    query.expectedProjectLifecycleRevision
  );
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
    const enabled = new Set(item.enabledComponentInstanceIdentities);
    const activeId = item.activeGenerationRef?.packageGenerationId;
    const activeGeneration = item.generations.find(
      (generation) => generation.packageGenerationId === activeId
    );
    packages.push({
      installIdentity: item.installIdentity,
      scope: item.scope,
      sourceIdentity: item.sourceIdentity,
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
            isRendererVisibleExtensionComponent(component) &&
            component.packageGenerationRef.packageGenerationId === activeId
        )
        .map((component) => ({
          declaredComponentIdentity: component.declaredComponentIdentity,
          componentInstanceIdentity: component.componentInstanceIdentity,
          componentId: component.componentId,
          kind: component.kind,
          transport: component.transport,
          enabled: enabled.has(component.componentInstanceIdentity),
          eligibility: capability.map((capabilitySnapshot) => {
            const entry = capabilitySnapshot.entries.find(
              (value) =>
                value.componentInstanceIdentity ===
                component.componentInstanceIdentity
            );
            if (!entry) {
              return {
                backendId: capabilitySnapshot.backendId,
                channel: component.transport,
                eligible: false,
                strength: "unsupported-by-policy" as const,
                exclusionCode: "transport-unsupported" as const,
              };
            }
            return {
              backendId: capabilitySnapshot.backendId,
              channel: component.transport,
              eligible: entry.eligible,
              strength: entry.deliveryStrength,
              ...(entry.exclusion
                ? { exclusionCode: entry.exclusion.code }
                : {}),
            };
          }),
          deliveryHealth: SETTINGS_BACKENDS.map((backendId) => ({
            backendId,
            channel: component.transport,
            status: "unknown" as const,
          })),
        })),
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
  const turnContext = query.scope.kind === "project"
    ? {
        projectId: query.scope.projectId,
        projectLifecycleRevision: query.expectedProjectLifecycleRevision,
      }
    : { projectId: null, projectLifecycleRevision: null };
  return {
    version: inventory.version,
    packages,
    /* Diagnostic/L1 only: Project snapshots keep the stable shape but no CLI
       backend inventory crosses the Project owner boundary. */
    agentPlugins:
      query.scope.kind === "global"
        ? await deps.agentPlugins.snapshot(inventory)
        : [],
    productSessionAdmissionClosed:
      deps.convergence.productSessionAdmissionClosed(turnContext),
    retainedInstallData: await deps.uninstall.retainedInstallData(query.scope),
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
    scope: preflight.scope,
    sourceIdentity: preflight.sourceIdentity,
    projectLifecycleRevision: preflight.projectLifecycleRevision,
    scopeRevision: preflight.scopeRevision,
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

export function assertExtensionPreflightInput(
  raw: unknown,
  deps: ExtensionsRegistrarDependencies
) {
  const input = assertObject(raw, "扩展预检参数");
  assertExactKeys(input, [
    "repoUrl",
    "requestedRef",
    "subdirectory",
    "scope",
    "expectedProjectLifecycleRevision",
    "expectedScopeRevision",
  ]);
  const authority = assertAuthority(
    {
      scope: assertProductResourceScope(input.scope),
      expectedProjectLifecycleRevision: assertNullableRevision(
        input.expectedProjectLifecycleRevision
      ),
    },
    deps
  );
  return {
    repoUrl: assertString(input.repoUrl, "repoUrl"),
    ...(input.requestedRef === undefined
      ? {}
      : { requestedRef: assertString(input.requestedRef, "requestedRef") }),
    ...(input.subdirectory === undefined
      ? {}
      : { subdirectory: assertString(input.subdirectory, "subdirectory") }),
    scope: authority.scope,
    expectedProjectLifecycleRevision:
      authority.expectedProjectLifecycleRevision,
    expectedScopeRevision: assertRevision(
      input.expectedScopeRevision,
      "expectedScopeRevision"
    ),
  };
}

export function assertExtensionConfirmInput(raw: unknown) {
  const input = assertObject(raw, "扩展确认参数");
  assertExactKeys(input, [
    "preflightId",
    "expectedContentDigest",
    "expectedResolvedCommit",
    "migrateAppIds",
  ]);
  const digest = assertString(
    input.expectedContentDigest,
    "expectedContentDigest"
  );
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error("contentDigest 格式无效");
  }
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

export function assertExtensionQuery(
  raw: unknown,
  deps: ExtensionsRegistrarDependencies
): ExtensionScopeQuery {
  const input = assertObject(raw, "Extension scope query");
  assertExactKeys(input, ["scope", "expectedProjectLifecycleRevision"]);
  return assertAuthority(
    {
      scope: assertProductResourceScope(input.scope),
      expectedProjectLifecycleRevision: assertNullableRevision(
        input.expectedProjectLifecycleRevision
      ),
    },
    deps
  );
}

export function assertExtensionMutation(
  raw: unknown,
  deps: ExtensionsRegistrarDependencies,
  extraKeys: readonly string[] = []
): ExtensionScopeMutation {
  const input = assertObject(raw, "Extension scope mutation");
  assertExactKeys(input, [
    "installIdentity",
    "expectedScope",
    "expectedProjectLifecycleRevision",
    "expectedScopeRevision",
    ...extraKeys,
  ]);
  const authority = assertAuthority(
    {
      scope: assertProductResourceScope(input.expectedScope),
      expectedProjectLifecycleRevision: assertNullableRevision(
        input.expectedProjectLifecycleRevision
      ),
    },
    deps
  );
  return {
    installIdentity: assertExtensionDigestIdentity(
      input.installIdentity,
      "installIdentity"
    ),
    expectedScope: authority.scope,
    expectedProjectLifecycleRevision:
      authority.expectedProjectLifecycleRevision,
    expectedScopeRevision: assertRevision(
      input.expectedScopeRevision,
      "expectedScopeRevision"
    ),
  };
}

function assertAuthority(
  query: ExtensionScopeQuery,
  deps: ExtensionsRegistrarDependencies
): ExtensionScopeQuery {
  if (query.scope.kind === "global") {
    if (query.expectedProjectLifecycleRevision !== null) {
      throw conflict("Global scope 不接受 Project lifecycle revision");
    }
    return query;
  }
  const expected = query.expectedProjectLifecycleRevision;
  if (expected === null) throw conflict("Project scope 缺少 lifecycle revision");
  deps.projects.store.assertProjectLifecycle(query.scope.projectId, expected);
  return query;
}

function queryOf(input: ExtensionScopeMutation): ExtensionScopeQuery {
  return {
    scope: input.expectedScope,
    expectedProjectLifecycleRevision: input.expectedProjectLifecycleRevision,
  };
}

function assertObject(raw: unknown, label: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}无效`);
  }
  return raw as Record<string, unknown>;
}

function assertExactKeys(
  input: Record<string, unknown>,
  allowed: readonly string[]
) {
  const allow = new Set(allowed);
  const unexpected = Object.keys(input).filter((key) => !allow.has(key));
  if (unexpected.length) {
    throw new Error(`Extension IPC 含未声明字段：${unexpected.join("、")}`);
  }
}

function assertString(raw: unknown, field: string) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${field} 无效`);
  }
  return raw;
}

function assertStringArray(raw: unknown, field: string) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${field} 无效`);
  return raw.map((item) => assertString(item, field));
}

function assertNullableRevision(raw: unknown) {
  if (raw === null) return null;
  return assertRevision(raw, "projectLifecycleRevision");
}

function assertRevision(raw: unknown, field: string) {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    raw < 0
  ) {
    throw new Error(`${field} 无效`);
  }
  return raw;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
