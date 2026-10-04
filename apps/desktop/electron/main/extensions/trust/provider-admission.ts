/**
 * [INPUT]: Depends on node:path, the built-in Provider descriptors, the Provider catalog (d4a: who supplies an id, and why one is unavailable), d4a's package reader (d1's admission), the host-package runtime's trust verdict and revoked mark, and the d4-0 admission hook's types.
 * [OUTPUT]: Provides createProviderAdmission (the package-Provider gate, its synchronous revocation check, the active packages' sensitive roots, refresh and runnable), the catalog's runnable policy holder (providerRunnable, installProviderRunnablePolicy, onProviderRunnablePolicyChanged) and declaredLaunchRefusal (a package Provider's launch must be its declared one).
 * [POS]: TASK-11 d4c: the one admission gate for package Providers, extending TASK-14 S7 3b's host-package gate on the same verdict and revoked mark. Who supplies an id comes only from the catalog, so the two can never disagree; the four built-ins keep their bundled path (d3). A third-party bridge module has no isolation boundary this period, so production refuses it by name; only the private E2E entry selects `admit-trusted`, for a package trusted under the test anchor.
 */
import { basename } from "node:path";
import type { ProviderDescriptor } from "@bottega/contracts/model/provider";
import { BUILTIN_PROVIDER_DESCRIPTORS } from "../../../../shared/providers/builtin";
import type { ProviderAdmissionGate, ProviderAdmissionRefusal } from "../../providers/host/admission";
import type { ProviderCatalogPort } from "../../providers/host/catalog";
import { readProviderPackage } from "../../providers/host/packages/package-catalog";
import type { HostPackageRuntime } from "../host/runtime";
import type { ExtensionRegistryStore } from "../registry/registry-store";

const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_PROVIDER_DESCRIPTORS.map(descriptor => descriptor.providerId));
/* The catalog's reason a package Provider is unavailable, in the d4-0 admission vocabulary. */
const REFUSAL_OF: Readonly<Record<string, ProviderAdmissionRefusal>> = {
  "package-disabled": "plugin-disabled", "package-refused": "package-inactive", "package-removed": "package-inactive", "trust-refused": "trust-refused",
};

export function createProviderAdmission(ports: {
  catalog: Pick<ProviderCatalogPort, "packageOf" | "snapshot">;
  hostPackages: Pick<HostPackageRuntime, "trustVerdict" | "isRevoked">;
  /** For the sensitive roots only: every active, valid package's descriptor, read through d1's admission as the catalog reads it. */
  registry: Pick<ExtensionRegistryStore, "hostPackages">;
  packageRoot(contentDigest: string): string;
  /** `admit-trusted` is for the private E2E entry only (a guard test keeps it out of production sources). */
  thirdPartyModules?: "refuse" | "admit-trusted";
}) {
  const gate: ProviderAdmissionGate = async providerId => {
    if (BUILTIN_IDS.has(providerId)) return null;
    const supplier = ports.catalog.packageOf(providerId);
    if (!supplier) {
      const entry = ports.catalog.snapshot().entries.find(item => item.id === providerId && item.source === "package");
      if (!entry?.unavailableReason) return "unknown-provider";
      /* In production the catalog lists every third-party Provider as refused (`runnable` is false): that is the one ruled code, not a
         vague inactive package. A turned-off package still says so first, since the person can act on it. */
      if (entry.unavailableReason === "package-refused" && ports.thirdPartyModules !== "admit-trusted") return "provider-module-third-party-refused";
      return REFUSAL_OF[entry.unavailableReason] ?? "package-inactive";
    }
    const verdict = await ports.hostPackages.trustVerdict(supplier.installIdentity);
    if (!verdict) return "package-inactive";
    if (verdict.status === "refused") return "trust-refused";
    /* Local confirmation admits a package's own hosts (the person trusted it at install), never third-party code inside the bridge. */
    return ports.thirdPartyModules === "admit-trusted" && verdict.status === "trusted" ? null : "provider-module-third-party-refused";
  };

  /** Synchronous, from the same revoked mark: the Provider bridge's last check before it creates a host. */
  const revocationCheck = (providerId: string): ProviderAdmissionRefusal | null => {
    const supplier = ports.catalog.packageOf(providerId);
    return supplier && ports.hostPackages.isRevoked(supplier.installIdentity) ? "trust-refused" : null;
  };

  /* Descriptors by generation (its bytes never change); an active package that is not a usable Provider package has none. */
  const descriptors = new Map<string, ProviderDescriptor | null>();
  let roots: readonly { providerId: string; paths: readonly string[] }[] = [];
  /** Re-reads every active, valid package's own sensitive roots; the composition runs it on each inventory change. */
  async function refresh() {
    const next: { providerId: string; paths: readonly string[] }[] = [];
    for (const owner of ports.registry.hostPackages()) {
      if (owner.admission !== "valid" || owner.administrativeState !== "active") continue;
      const generation = owner.generations.find(item => item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId);
      if (!generation) continue;
      let descriptor = descriptors.get(generation.packageGenerationId);
      if (descriptor === undefined) {
        const offered = await readProviderPackage(ports.packageRoot(generation.contentDigest)).catch(() => null);
        descriptor = offered && !("refused" in offered) ? offered.descriptor as unknown as ProviderDescriptor : null;
        descriptors.set(generation.packageGenerationId, descriptor);
      }
      if (descriptor) next.push({ providerId: descriptor.providerId, paths: descriptor.sensitiveRoots.paths });
    }
    roots = next;
  }

  /** Every active package's own sensitive roots, except the asking Provider's own: foreign to everyone else's fence. */
  const sensitiveRoots = (exceptProviderId: string | undefined): readonly string[] =>
    roots.filter(entry => entry.providerId !== exceptProviderId).flatMap(entry => entry.paths);

  /** Whether this policy would ever run the package's Provider: never in production; under the E2E policy, unless revoked (d4a's `runnable`). */
  const runnable = (installIdentity: string) => ports.thirdPartyModules === "admit-trusted" && !ports.hostPackages.isRevoked(installIdentity);

  return { gate, revocationCheck, sensitiveRoots, refresh, runnable };
}

/* The catalog's `runnable` port reads the installed policy: production installs its admission's, the private E2E entry swaps in its
   own; nothing installed means not runnable. A change asks the catalog to rebuild, so no list keeps offering what the gate refuses. */
let runnablePolicy: ((installIdentity: string) => boolean) | null = null;
const runnableListeners = new Set<() => void>();
export const providerRunnable = (installIdentity: string) => runnablePolicy?.(installIdentity) ?? false;
export function installProviderRunnablePolicy(policy: ((installIdentity: string) => boolean) | null) {
  runnablePolicy = policy;
  for (const listener of runnableListeners) { try { listener(); } catch (cause) { console.warn("[providers] runnable policy listener failed", cause); } }
}
export function onProviderRunnablePolicyChanged(listener: () => void) { runnableListeners.add(listener); return () => { runnableListeners.delete(listener); }; }

/**
 * A package Provider's process must be the executable discovery found on PATH under one of its declared command names, with exactly
 * its declared arguments (absent means none): nothing the bridge or a turn computed. The name rule reads the path discovery found
 * (a declared `foo` is often a symlink into its install), the identity rule the resolved executable the sealed plan must name.
 */
export function declaredLaunchRefusal(descriptor: ProviderDescriptor, launch: Readonly<{ command: string; args: readonly string[] }>,
  discovered: Readonly<{ path: string; realpath: string }>): "provider-launch-undeclared" | null {
  if (!descriptor.runtime.discovery.commands.includes(basename(discovered.path)) || launch.command !== discovered.realpath) return "provider-launch-undeclared";
  const declared = descriptor.runtime.launch.args ?? [];
  return launch.args.length === declared.length && declared.every((arg, index) => arg === launch.args[index]) ? null : "provider-launch-undeclared";
}
