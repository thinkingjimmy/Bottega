/**
 * [INPUT]: Depends on the existing Extension installer, frozen preflight identities and lifecycle checkpoints.
 * [OUTPUT]: Fulfills explicit App extension requirements with content/capability verification and crash recovery.
 * [POS]: Shared delivery kernel; no extension authorization is copied from another device.
 */
import type { AppExtensionInstallPreflight } from "../../../../../shared/apps-ipc";
import type { ExtensionInstaller } from "../../../extensions/install/installer";
import { digestCanonical } from "../../../extensions/registry-canonical";
import type { LifecycleIntent } from "../../../lifecycle/intent-types";
import type { LifecycleIntentStore } from "../../../lifecycle/intent-store";
export type AppExtensionDelivery = Pick<ExtensionInstaller, "preflight" | "confirm" | "discard" | "isInstalled" | "scopeRevision">;
export function fulfillmentInput(preflights: readonly AppExtensionInstallPreflight[] | undefined) {
  return (preflights ?? []).map(({ capabilities: _capabilities, preflightId: _id, state: _state, ...item }) => item);
}
export function fulfillmentFromIntent(intent: LifecycleIntent): AppExtensionInstallPreflight[] {
  const rows = Array.isArray(intent.input.extensionFulfillment) ? intent.input.extensionFulfillment : [];
  return rows.map(value => ({ ...(value as Omit<AppExtensionInstallPreflight, "capabilities" | "preflightId" | "state">),
    capabilities: { executableScripts: [], skills: [], mcpServers: [], requiresPluginDataWriteRoot: false }, preflightId: null, state: "ready" }));
}
export async function fulfillExtensions(ports: { extensions: AppExtensionDelivery | null; journal: LifecycleIntentStore },
  initialIntent: LifecycleIntent, initial: readonly AppExtensionInstallPreflight[]) {
  let intent = initialIntent;
  const expected = fulfillmentFromIntent(intent);
  if (!expected.length) return { complete: true, error: "" };
  const failed = async (error: string) => {
    await ports.journal.advance(intent.intentId, intent.phase, { extensionFulfillmentError: error.slice(0, 3_500) });
    return { complete: false, error };
  };
  const extensions = ports.extensions;
  if (!extensions) return failed("APP_EXTENSION_DELIVERY_UNAVAILABLE");
  const completed = new Set(Array.isArray(intent.recoveryState.fulfilledExtensions) ?
    intent.recoveryState.fulfilledExtensions.filter((value): value is string => typeof value === "string") : []);
  try {
    for (const item of expected) {
      if (completed.has(item.declaredComponentIdentity)) continue;
      const held = initial.find(candidate => candidate.declaredComponentIdentity === item.declaredComponentIdentity && candidate.preflightId);
      if (extensions.isInstalled(item)) {
        if (held?.preflightId) await extensions.discard(held.preflightId);
      } else {
        let preflight = held;
        if (!preflight) {
          const value = await extensions.preflight({ repoUrl: item.repoUrl, requestedRef: item.resolvedCommit, scope: item.scope,
            expectedProjectLifecycleRevision: item.projectLifecycleRevision, expectedScopeRevision: extensions.scopeRevision(item.scope) });
          preflight = { declaredComponentIdentity: item.declaredComponentIdentity, scope: value.scope,
            projectLifecycleRevision: value.projectLifecycleRevision, scopeRevision: value.scopeRevision,
            repoUrl: value.source.normalizedUrl, requestedRef: value.source.requestedRef, resolvedCommit: value.source.resolvedCommit,
            contentDigest: value.contentDigest, capabilityDigest: digestCanonical(value.disclosure),
            capabilities: value.disclosure, preflightId: value.preflightId, state: "ready" };
        }
        if (!preflight.preflightId) throw new Error("APP_EXTENSION_PREFLIGHT_MISSING");
        if (preflight.contentDigest !== item.contentDigest || preflight.capabilityDigest !== item.capabilityDigest || preflight.resolvedCommit !== item.resolvedCommit) {
          await extensions.discard(preflight.preflightId);
          throw new Error("APP_EXTENSION_SOURCE_CHANGED");
        }
        await extensions.confirm({ preflightId: preflight.preflightId, expectedContentDigest: item.contentDigest, expectedResolvedCommit: item.resolvedCommit });
      }
      completed.add(item.declaredComponentIdentity);
      intent = await ports.journal.advance(intent.intentId, intent.phase, { fulfilledExtensions: [...completed].sort(), extensionFulfillmentError: null });
    }
    return { complete: true, error: "" };
  } catch (cause) {
    await Promise.allSettled(initial.flatMap(item => item.preflightId && !completed.has(item.declaredComponentIdentity) ? [extensions.discard(item.preflightId)] : []));
    return failed(cause instanceof Error ? cause.message : String(cause));
  }
}
