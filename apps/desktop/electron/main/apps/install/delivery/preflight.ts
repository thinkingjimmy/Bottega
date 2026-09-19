/**
 * [INPUT]: Depends on declared Extension sources and the existing installer preflight authority.
 * [OUTPUT]: Freezes exact component, source and capability disclosures before App installation consent.
 * [POS]: Shared GitHub/cloud delivery preparation; it does not install or grant anything.
 */
import type { AppExtensionInstallPreflight } from "../../../../../shared/apps-ipc";
import type { AppExtensionRequirementDeclaration } from "../../../../../shared/extensions-ipc";
import { GLOBAL_PRODUCT_RESOURCE_SCOPE } from "../../../../../shared/product-resource-scope";
import { digestCanonical } from "../../../extensions/registry-canonical";
import type { AppExtensionDelivery } from "./extensions";
export async function preflightAppExtension(declaration: AppExtensionRequirementDeclaration,
  extensions: Pick<AppExtensionDelivery, "preflight" | "discard" | "scopeRevision"> | null): Promise<AppExtensionInstallPreflight | null> {
  if (!declaration.source) return null;
  if (!extensions) throw new Error("APP_EXTENSION_DELIVERY_UNAVAILABLE");
  const preflight = await extensions.preflight({ repoUrl: declaration.source.repoUrl,
    ...(declaration.source.ref ? { requestedRef: declaration.source.ref } : {}), scope: GLOBAL_PRODUCT_RESOURCE_SCOPE,
    expectedProjectLifecycleRevision: null, expectedScopeRevision: extensions.scopeRevision(GLOBAL_PRODUCT_RESOURCE_SCOPE) });
  if (!preflight.admission.components.some(component => `${preflight.componentNamespace}/${component.componentId}` === declaration.declaredComponentIdentity)) {
    await extensions.discard(preflight.preflightId);
    throw new Error("APP_EXTENSION_COMPONENT_UNAVAILABLE");
  }
  return { declaredComponentIdentity: declaration.declaredComponentIdentity, scope: preflight.scope,
    projectLifecycleRevision: preflight.projectLifecycleRevision, scopeRevision: preflight.scopeRevision,
    repoUrl: preflight.source.normalizedUrl, requestedRef: preflight.source.requestedRef, resolvedCommit: preflight.source.resolvedCommit,
    contentDigest: preflight.contentDigest, capabilityDigest: digestCanonical(preflight.disclosure),
    capabilities: structuredClone(preflight.disclosure), preflightId: preflight.preflightId, state: "ready" };
}
