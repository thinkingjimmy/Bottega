/**
 * [INPUT]: Depends on trusted renderer admission, scoped Extension services, the local chooser and account-bound plugin request inbox.
 * [OUTPUT]: Provides main-window-only preview/confirmation, exact-scope lifecycle commands and owner-computer request review with revision invalidation.
 * [POS]: Native install boundary; Plugins accepts global host packages, Extensions accepts its existing families and remote requests cannot approve.
 */

import { app, dialog, type BrowserWindow } from "electron";
import { preflightLocalFromDialog } from "./install/local-preflight";
import { rendererInstallEntry, takeInstallSurface } from "./install/renderer/entry";
import { pluginInstallRequests } from "./install/renderer/requests";
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
} from "../../../shared/ipc/settings/extensions-ipc";
import {
  assertProductResourceScope,
  type ProductResourceScope,
} from "../../../shared/product/product-resource-scope";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import { statusError } from "../ipc/errors";
import { rendererIpc } from "../registration/ipc-registrar";
import type { ProjectsService } from "../projects/projects-service";
import type {
  ExtensionInstaller,
  ExtensionInstallPreflight,
} from "./install/installer";
import type { ExtensionDisableConvergence } from "./lifecycle/disable-convergence";
import type { ExtensionPackageUninstall } from "./lifecycle/package-uninstall";
import type { ExtensionRegistryStore } from "./registry/registry-store";
import { buildExtensionCapabilitySnapshot } from "./capability-snapshot";
import {
  backendExtensionProbe,
  EXTENSION_PRODUCT_POLICY,
} from "./product-policy";
import type { AgentPluginInventory } from "./agent-plugins/inventory";
import { hostPackageSwitchable } from "./product-policy";

const SETTINGS_BACKENDS: readonly AgentBackendId[] = [
  "codex",
  "claude",
  "kimi",
  "opencode",
];

export function isRendererVisibleExtensionComponent(
  component: Pick<ExtensionComponentRecord, "kind">
) {
  return component.kind === "skill" || component.kind === "mcp-server" || component.kind === "host-entry";
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
  const installs = rendererInstallEntry(deps.installer);
  window.once("closed", () => installs.close());
  const releaseRequests = pluginInstallRequests()?.onChanged(() => sendInvalidation({ scope: { kind: "global" }, scopeRevision: deps.registry.scopeRevision({ kind: "global" }) }));
  window.once("closed", () => releaseRequests?.());
  rendererIpc(rendererUrl, "拒绝非主窗口的扩展请求")
    .roles("main")
    .handle(EXTENSIONS_CHANNEL.list, (raw) =>
      snapshot(assertExtensionQuery(raw, deps))
    )
    .handle(EXTENSIONS_CHANNEL.preflight, async (raw) => {
      const request = takeInstallSurface(raw);
      const input = assertExtensionPreflightInput(request.input, deps);
      const userId = pluginInstallRequests()?.currentUser();
      if (request.remoteRequestId) {
        const pending = pluginInstallRequests()?.review(request.remoteRequestId);
        if (!pending) throw new Error("plugin-request-unavailable");
        input.repoUrl = pending.repoUrl; input.requestedRef = pending.requestedRef; input.subdirectory = pending.subdirectory;
      }
      return projectPreflight(await installs.preview(request.surface, await deps.installer.preflight(input), request.remoteRequestId, userId));
    })
    .handle(EXTENSIONS_CHANNEL.installRequests, () => pluginInstallRequests()?.list() ?? [])
    .handle(EXTENSIONS_CHANNEL.declineInstallRequest, id => pluginInstallRequests()?.change(assertString(id, "requestId"), "declined"))
    .handle(EXTENSIONS_CHANNEL.localInstallAvailable, surface => surface === "plugins" || !app.isPackaged)
    .handle(EXTENSIONS_CHANNEL.preflightLocal, async (raw) => {
      const request = takeInstallSurface(raw);
      const preflight = await preflightLocalFromDialog(request.input, {
        isPackaged: app.isPackaged,
        allowPackaged: request.surface === "plugins",
        chooseDirectory: async () => {
          const result = await dialog.showOpenDialog(window, { properties: request.surface === "plugins" ? ["openDirectory", "openFile"] : ["openDirectory"] });
          return result.canceled ? null : result.filePaths[0] ?? null;
        },
        assertAuthority: (input) => {
          if (window.isDestroyed()) throw conflict("Window is closed");
          assertAuthority(input, deps);
          if (deps.registry.scopeRevision(input.scope) !== input.expectedScopeRevision) throw conflict("Extension scope changed");
        },
        preflight: (input) => deps.installer.preflightLocal(input),
      });
      return preflight ? projectPreflight(await installs.preview(request.surface, preflight)) : null;
    })
    .handle(EXTENSIONS_CHANNEL.confirm, async (raw) => {
      const request = takeInstallSurface(raw);
      const input = assertExtensionConfirmInput(request.input);
      const held = deps.installer.heldAuthorization(input.preflightId);
      if (!held) throw conflict("扩展预检已失效");
      assertAuthority(
        {
          scope: held.scope,
          expectedProjectLifecycleRevision: held.projectLifecycleRevision,
        },
        deps
      );
      const finish = await installs.confirm(request.surface, input.preflightId);
      try { await deps.installer.confirm(input); await finish("installed"); }
      catch (cause) { await finish("unknown"); throw cause; }
      return snapshot({
        scope: held.scope,
        expectedProjectLifecycleRevision: held.projectLifecycleRevision,
      });
    })
    .handle(EXTENSIONS_CHANNEL.discard, (raw) =>
      installs.discard(assertString(raw, "preflightId"))
    )
    .handle(EXTENSIONS_CHANNEL.beginDisable, async (raw) => {
      const input = assertExtensionMutation(raw, deps);
      /* D-04: the same rule as Plugins & Apps — a host package is turned off only where it can be turned back on. */
      const hostPackage = deps.registry.hostPackages().find((item) => item.installIdentity === input.installIdentity);
      if (hostPackage && !hostPackageSwitchable(hostPackage.scope)) throw new Error("plugin-not-switchable");
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
      if (typeof input.enabled !== "boolean") throw new Error("Agent Plugin 启停参数无效");
      /* Refused for a provider whose plugin code cannot toggle one plugin in the product. */
      await deps.agentPlugins.setEnabled(
        assertString(input.backendId, "backendId"),
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
        })),
      retainedGenerations: item.generations
        .filter((generation) => generation.packageGenerationId !== activeId)
        .map((generation) => ({
          generationId: generation.packageGenerationId,
          resolvedCommit:
            deps.registry.installs.generationSource(generation.packageGenerationId)
              ?.resolvedCommit ?? "",
          blockerCount: deps.registry.lifecycle.blockers({
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
    trust: preflight.trust,
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

function assertExtensionPreflightInput(
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

function assertExtensionMutation(
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
  return statusError(409, message);
}
