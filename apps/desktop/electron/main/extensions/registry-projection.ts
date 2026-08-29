/**
 * [INPUT]: Depends on Registry stored packages, exact generation keys, and shared component records
 * [OUTPUT]: Provides backend-neutral visible candidate preservation with same-scope ambiguity fail-closed behavior
 * [POS]: Registry inventory projection kernel; backend eligibility performs the final D13 choice downstream
 */

import type { ExtensionComponentRecord } from "../../../shared/extensions-ipc";
import type { ExtensionRegistryStoredPackage } from "./registry-schema";
import { refKey } from "./registry-canonical";

export function activeComponents(packages: readonly ExtensionRegistryStoredPackage[]) {
  return packages.flatMap((item) => {
    const active = refKey(item.activeGenerationRef);
    return item.components.filter(
      (component) => refKey(component.packageGenerationRef) === active
    );
  });
}

export function selectVisibleComponents(
  globalPackages: readonly ExtensionRegistryStoredPackage[],
  projectPackages: readonly ExtensionRegistryStoredPackage[]
): ExtensionComponentRecord[] {
  const select = (packages: readonly ExtensionRegistryStoredPackage[]) => {
    const candidates = activeComponents(packages).filter((component) => {
      const owner = packages.find((item) =>
        item.components.some(
          (entry) => entry.componentInstanceIdentity === component.componentInstanceIdentity
        )
      );
      return Boolean(
        owner &&
          owner.administrativeState === "active" &&
          owner.enabledComponentInstanceIdentities.includes(
            component.componentInstanceIdentity
          )
      );
    });
    const grouped = new Map<string, ExtensionComponentRecord[]>();
    for (const component of candidates) {
      const values = grouped.get(component.declaredComponentIdentity) ?? [];
      values.push(component);
      grouped.set(component.declaredComponentIdentity, values);
    }
    return new Map(
      [...grouped].map(([identity, values]) => [
        identity,
        values.length === 1 ? values[0]! : null,
      ])
    );
  };
  const global = select(globalPackages);
  const project = select(projectPackages);
  const identities = new Set([...global.keys(), ...project.keys()]);
  return [...identities]
    .flatMap((identity) => {
      const globalCandidate = global.get(identity);
      const projectCandidate = project.get(identity);
      if (globalCandidate === null || projectCandidate === null) return [];
      return [globalCandidate, projectCandidate].filter(
        (value): value is ExtensionComponentRecord => Boolean(value)
      );
    })
    .sort(
      (left, right) =>
        left.declaredComponentIdentity.localeCompare(right.declaredComponentIdentity) ||
        left.componentInstanceIdentity.localeCompare(right.componentInstanceIdentity)
    );
}
