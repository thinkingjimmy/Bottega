/**
 * [INPUT]: Unified manifest and contribution schemas.
 * [OUTPUT]: PluginContributionRegistry with retained registration intent, effective Slot availability, exact virtual host Slots and strict new ownership/injection/replacement checks.
 * [POS]: Pure registration authority shared by catalog activation, modes and main-window contribution hosts.
 */
import { unifiedPluginManifestSchema, type PluginContribution, type UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";

export type RegisteredPluginContribution = Readonly<{ pluginId: string; contribution: PluginContribution; version: string }>;
const HOST_SLOTS = ["main.pages", "sidebar.navigation", "composer.above", "composer.below", "dock.widgets"] as const;
export class PluginContributionRegistry {
  private manifests = new Map<string, UnifiedPluginManifest>();
  private contributions = new Map<string, RegisteredPluginContribution>();
  private available = new Set<string>();

  register(input: UnifiedPluginManifest, options: { replace?: boolean } = {}): void {
    const manifest = unifiedPluginManifestSchema.parse(input);
    if (this.manifests.has(manifest.id) && !options.replace) throw new Error("Plugin is already registered; explicit replacement is required");
    const proposed = new Map(this.manifests); proposed.set(manifest.id, manifest);
    this.rebuild(proposed, manifest.id);
  }
  unregister(pluginId: string): void {
    const proposed = new Map(this.manifests); proposed.delete(pluginId);
    this.rebuild(proposed);
  }
  has(pluginId: string): boolean { return this.available.has(pluginId); }
  get(pluginId: string, contributionId: string): RegisteredPluginContribution | undefined {
    return this.contributions.get(pluginId + ":" + contributionId);
  }
  list(kind?: PluginContribution["kind"]): RegisteredPluginContribution[] {
    return structuredClone([...this.contributions.values()].filter(value => !kind || value.contribution.kind === kind));
  }
  validateCandidate(manifest: UnifiedPluginManifest): void {
    const proposed = new Map(this.manifests); proposed.set(manifest.id, manifest);
    this.validate(proposed, manifest.id);
  }
  private validate(manifests: Map<string, UnifiedPluginManifest>, candidateId?: string): Set<string> {
    const slots = new Map<string, string>(HOST_SLOTS.map(slot => [slot, "host"]));
    for (const manifest of manifests.values()) {
      for (const slot of manifest.slots.declares) {
        const existing = slots.get(slot);
        if (existing) throw new Error("Slot is already owned: " + slot + " (" + existing + ")");
        slots.set(slot, manifest.id);
      }
    }
    // Prune unavailable branches without losing their admitted registration intent or rejecting valid mutual owners.
    const available = new Set(manifests.keys()); let previous: number;
    do {
      previous = available.size;
      for (const manifest of manifests.values())
        if (available.has(manifest.id) && this.invalid(manifest, slots, available)) available.delete(manifest.id);
    } while (available.size !== previous);
    const issue = candidateId && this.invalid(manifests.get(candidateId)!, slots, available);
    if (issue) throw new Error(issue);
    return available;
  }
  private invalid(manifest: UnifiedPluginManifest, slots: Map<string, string>, available: Set<string>): string | undefined {
    const live = (owner: string, slot: string) => owner === manifest.id || available.has(owner) || owner === "host" && HOST_SLOTS.includes(slot as typeof HOST_SLOTS[number]);
    for (const inject of manifest.slots.injects)
      if (slots.get(inject.slot) !== inject.ownerPluginId || !live(inject.ownerPluginId, inject.slot)) return "Slot owner is unavailable or differs: " + inject.slot;
    for (const contribution of manifest.contributions) {
      if (!("slot" in contribution) || !contribution.slot) continue;
      const owner = slots.get(contribution.slot);
      if (!owner) return "Slot was not declared: " + contribution.slot;
      if (owner !== manifest.id && !manifest.slots.injects.some(value => value.slot === contribution.slot && value.ownerPluginId === owner))
        return "Foreign slot injection requires an explicit declaration: " + contribution.slot;
      if (!live(owner, contribution.slot)) return "Slot owner is unavailable or differs: " + contribution.slot;
    }
  }
  private rebuild(manifests: Map<string, UnifiedPluginManifest>, candidateId?: string) {
    const available = this.validate(manifests, candidateId), contributions = new Map<string, RegisteredPluginContribution>();
    for (const manifest of manifests.values()) if (available.has(manifest.id))
      for (const contribution of manifest.contributions)
        contributions.set(manifest.id + ":" + contribution.id, { pluginId: manifest.id, contribution, version: manifest.version });
    this.manifests = manifests; this.available = available; this.contributions = contributions;
  }
}
