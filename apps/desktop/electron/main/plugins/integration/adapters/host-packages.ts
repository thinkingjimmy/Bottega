/**
 * [INPUT]: Depends on the existing signed Registry/HostPackage runtime, actual contract/trust readiness and exact owner lifecycle actions.
 * [OUTPUT]: Provides one stable unified read-only external plugin per Host Package installation and delegated generation/enablement/removal updates.
 * [POS]: External-format adapter; SDK/Provider metadata remains a low-level execution protocol and creates no separate editable plugin identity.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { unifiedPluginManifestSchema } from "@bottega/contracts/plugins/platform";
import type { HostPackageRuntime } from "../../../extensions/host/runtime";
import type { ExtensionRegistryStore } from "../../../extensions/registry/registry-store";
import type { PluginCatalog } from "../../catalog";
import type { UnifiedPluginPlatform } from "../../platform/service";
import { durableReplaceFile } from "../../../persistence/durable-json";
export const hostPackagePluginId = (installIdentity: string) => "hostpkg_" + hashCanonical(installIdentity).slice(0, 40);
type Ports = { platform: UnifiedPluginPlatform; registry: Pick<ExtensionRegistryStore, "hostPackages" | "onInventoryChanged">;
  packages: Pick<HostPackageRuntime, "manifest" | "negotiate" | "trustVerdict" | "isRevoked" | "onRevoked">;
  catalog: Pick<PluginCatalog, "setEnabled">; libraryRoot(): string | null; remove?(installIdentity: string): Promise<void>; reportError?(cause: unknown): void };
export async function composeHostPackagePluginAdapters(ports: Ports) {
  const registered = new Map<string, () => void>(), fingerprints = new Map<string, string>(), readiness = new Map<string, { generationId: string; ready: boolean; error?: string }>();
  let closed = false, chain: Promise<unknown> = Promise.resolve();
  const refresh = () => {
    const task = chain.catch(() => undefined).then(async () => {
      if (closed) return;
      const records = ports.registry.hostPackages(), alive = new Set(records.map(record => hostPackagePluginId(record.installIdentity)));
      for (const [id, stop] of registered) if (!alive.has(id)) { stop(); registered.delete(id); fingerprints.delete(id); readiness.delete(id); if (ports.platform.get(id)) await ports.platform.remove({ pluginId: id }).catch(cause => { if (ports.platform.get(id)) throw cause; }); }
      for (const record of records) {
        const id = hostPackagePluginId(record.installIdentity), generation = record.generations.find(value => value.packageGenerationId === record.activeGenerationRef?.packageGenerationId);
        const legacy = await ports.packages.manifest(record.installIdentity), library = ports.libraryRoot(); if (!legacy || !generation || !library) continue;
        const manifest = unifiedPluginManifestSchema.parse({ schemaVersion: 1, id, name: legacy.displayName.slice(0, 160), version: /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(legacy.packageVersion) ? legacy.packageVersion : "0.0.0",
          description: "Installed external Host Package. Settings, trust, Provider execution and retained data use its original package owner.",
          source: { kind: "external", format: "host-package", editable: false, installIdentity: record.installIdentity, externalVersion: legacy.packageVersion, revision: generation.contentDigest },
          slots: { declares: [], injects: [] }, dependencies: [], contributions: (["service", "bridge"] as const).flatMap(role => legacy.entries[role] ? [{ id: role, kind: "service", name: role === "bridge" && legacy.provider ? legacy.provider.id + " Provider" : legacy.displayName,
            entry: `host-package/${id}/${role}`, hostPackageId: record.installIdentity, parallelSafe: false }] : []) });
        const directory = join(library, "plugins", id, "source"), fingerprint = hashCanonical({ manifest, directory });
        if (fingerprints.get(id) !== fingerprint) { await mkdir(directory, { recursive: true, mode: 0o700 }); await durableReplaceFile(join(directory, "bottega.plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
          await ports.platform.register({ manifest, packageDirectory: directory, enabled: record.administrativeState === "active", trust: true, replace: true, hostAdapter: true }); fingerprints.set(id, fingerprint); }
        let error: string | undefined;
        if (record.admission !== "valid") error = "External package admission is invalid";
        else if (record.administrativeState === "active") {
          try { const verdict = await ports.packages.trustVerdict(record.installIdentity); if (verdict?.status === "refused" || ports.packages.isRevoked(record.installIdentity)) throw new Error("External package trust was revoked"); await ports.packages.negotiate(record.installIdentity); }
          catch (cause) { error = String((cause as Error).message).slice(0, 2048); }
        }
        readiness.set(id, { generationId: generation.packageGenerationId, ready: !error, ...(error ? { error } : {}) });
        if (!registered.has(id)) registered.set(id, ports.platform.registerHostAdapter(id, {
          state: () => { const current = ports.registry.hostPackages().find(value => value.installIdentity === record.installIdentity), state = readiness.get(id), enabled = current?.administrativeState === "active";
            const ready = Boolean(enabled && current?.admission === "valid" && state?.ready && state.generationId === current.activeGenerationRef?.packageGenerationId && !ports.packages.isRevoked(record.installIdentity));
            return { enabled, ready, status: current?.administrativeState === "disable-pending" ? "draining" : !enabled ? "disabled" : ready ? "ready" : "unavailable", ...(state?.error ? { error: state.error } : {}) }; },
          setEnabled: async enabled => { const current = ports.registry.hostPackages().find(value => value.installIdentity === record.installIdentity);
            if (!current || current.scope.kind !== "global") throw new Error("Project-owned packages must be changed in their exact Project");
            await ports.catalog.setEnabled(record.installIdentity, enabled); },
          remove: async () => { const current = ports.registry.hostPackages().find(value => value.installIdentity === record.installIdentity);
            if (current?.scope.kind !== "global") throw new Error("Project-owned packages must be removed from their exact Project");
            if (!ports.remove) throw new Error("Use the external package removal review to retain or delete its data"); await ports.remove(record.installIdentity); },
        }));
        await ports.platform.refreshHostAdapter(id);
      }
    });
    chain = task; return task;
  };
  const releaseInventory = ports.registry.onInventoryChanged(() => { void refresh().catch(cause => ports.reportError?.(cause)); });
  const releaseRevoked = ports.packages.onRevoked(() => { void refresh().catch(cause => ports.reportError?.(cause)); });
  await refresh();
  return { refresh, async close() { closed = true; releaseInventory(); releaseRevoked(); await chain.catch(() => undefined); for (const stop of registered.values()) stop(); registered.clear(); } };
}
