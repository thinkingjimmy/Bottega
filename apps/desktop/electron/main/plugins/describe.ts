/**
 * [INPUT]: Depends on the plugin contract (descriptor, catalog, contracts, settings types) and the host-package manifest type.
 * [OUTPUT]: Provides PluginEntry (one plugin as the catalog sees it: descriptor, switch state, platform support and extras), builtinEntry,
 *           packageEntry, nativeEntry, nodeOf (the resolver's input) and viewOf (the page's card, availability from the resolution).
 * [POS]: The pure projection step of electron/main/plugins: catalog.ts gathers facts through ports, this file turns them into one shape
 *        for every source (built-in, package, Agent-native) so list, detail, impact and negotiation read the same thing.
 */
import { AGENT_PROVIDER_CONTRACT, type PluginNode, type Resolution } from "@bottega/contracts/plugins/contracts";
import { nativePluginId, type PluginDescriptor } from "@bottega/contracts/plugins/descriptor";
import type { PluginView } from "@bottega/contracts/plugins/catalog";
import type { LocalizedText } from "@bottega/contracts/plugins/text";
import type { HostPackageManifest } from "@bottega/contracts/host/manifest";

export type PluginEntry = Readonly<{
  descriptor: PluginDescriptor;
  enabled: boolean;
  official: boolean;
  version: string | null;
  /** null: the platform runs it; otherwise why not (shown as "not supported on this computer"). */
  unsupported: LocalizedText | null;
  turnedOffAt?: number;
  managedBy?: string;
  origin?: string;
  /** Host packages: presentation, provider id and scope, for switching and Provider lookups. */
  providerId?: string;
  switchable: boolean;
}>;

export const builtinEntry = (descriptor: PluginDescriptor, input: { enabled: boolean; version: string; unsupported: LocalizedText | null; turnedOffAt: number | null }): PluginEntry => ({
  descriptor, enabled: input.enabled, official: true, version: input.version, unsupported: input.unsupported, switchable: descriptor.turnOff.allowed,
  ...(input.turnedOffAt === null ? {} : { turnedOffAt: input.turnedOffAt }), ...(descriptor.kind === "provider" ? { providerId: descriptor.id } : {}),
});

/** A host package keeps its declarations while off; enabled alone decides whether it may satisfy a dependency. */
export function packageEntry(installIdentity: string, manifest: HostPackageManifest | null, input: { active: boolean; switchable: boolean }): PluginEntry {
  const provides = manifest ? [...new Set([...manifest.provides.map(item => item.contract), ...(manifest.provider ? [AGENT_PROVIDER_CONTRACT] : [])])] : [];
  return {
    descriptor: {
      id: installIdentity, kind: manifest?.provider ? "provider" : "feature", source: "package",
      name: { text: manifest?.displayName ?? installIdentity }, summary: null, icon: null, provides, requires: manifest ? [...manifest.requires] : [],
      turnOn: { mode: "direct" }, turnOff: input.switchable ? { allowed: true } : { allowed: false, reason: "project-scoped" },
      settings: manifest?.settings ?? [],
      capabilities: manifest ? manifest.permissions.requestedCapabilities.map(capability => ({ label: { text: capability }, id: capability })) : [],
    },
    enabled: input.active, official: false, version: manifest?.packageVersion ?? null, unsupported: null, switchable: input.switchable,
    ...(manifest?.provider ? { providerId: manifest.provider.id } : {}),
  };
}

export const nativeEntry = (backendId: string, plugin: { id: string; displayName: string; source: string; enabled: boolean }): PluginEntry => ({
  descriptor: { id: nativePluginId(backendId, plugin.id), kind: "feature", source: "agent-native", name: { text: plugin.displayName }, summary: null,
    icon: backendId, provides: [], requires: [], turnOn: { mode: "direct" }, turnOff: { allowed: false, reason: "managed-by-agent" }, settings: [], capabilities: [] },
  enabled: plugin.enabled, official: false, version: null, unsupported: null, managedBy: backendId, origin: plugin.source, switchable: false,
});

export const nodeOf = (entry: PluginEntry): PluginNode => ({ id: entry.descriptor.id, provides: entry.descriptor.provides, requires: entry.descriptor.requires,
  enabled: entry.enabled, platformSupported: entry.unsupported === null });

export function viewOf(entry: PluginEntry, resolution: Resolution, extras: Pick<PluginView, "usedBy" | "workflowIn">): PluginView {
  const { descriptor } = entry;
  const blockedBy = resolution.plugins[descriptor.id]?.blockedBy ?? [];
  return {
    id: descriptor.id, name: descriptor.name, summary: descriptor.summary, icon: descriptor.icon ? { builtin: descriptor.icon } : null,
    kind: descriptor.kind, source: descriptor.source, official: entry.official, version: entry.version, enabled: entry.enabled,
    availability: entry.unsupported ? { state: "unsupported", reason: "platform", detail: entry.unsupported }
      : blockedBy.length ? { state: "blocked", blockedBy: [...blockedBy] } : { state: "usable" },
    turnOn: descriptor.turnOn, turnOff: descriptor.turnOff, hasSettings: descriptor.settings.length > 0,
    ...extras,
    ...(entry.managedBy ? { managedBy: entry.managedBy } : {}), ...(entry.origin ? { origin: entry.origin.slice(0, 512) } : {}),
    ...(entry.turnedOffAt === undefined ? {} : { turnedOffAt: entry.turnedOffAt }),
  };
}
