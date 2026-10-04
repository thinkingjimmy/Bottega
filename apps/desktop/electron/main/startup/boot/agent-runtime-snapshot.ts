/**
 * [INPUT]: Depends on the backend runtime registry and descriptors, the runtime version cache, RuntimeSnapshotStore, the startup trace, and the shared startup-snapshot launch-argument builder.
 * [OUTPUT]: Provides warmAgentDiscovery, which restores last launch's confirmed Agents as provisional BackendInfo (built-ins only: a package Provider's facts wait for this launch's catalog and discovery), keeps the durable snapshot in step with this launch's discovery and warms up the default Agent only, and startupSnapshotLauncher, the launch-argument builder that hands settings plus those Agents to each new window.
 * [POS]: startup/boot/ seam between CLI discovery and the window's startup snapshot; index.ts decides when each runs and awaits the provisional list itself.
 */

import type { AgentBackendId, BackendInfo } from "../../../../shared/ipc/agent/agent-ipc";
import type { SettingsEnvelope } from "../../../../shared/ipc/settings/settings-ipc";
import { startupSnapshotArgument } from "../../../../shared/startup/startup-snapshot";
import { join } from "node:path";
import { backendById, backendRuntimeRegistry } from "../../backends";
import { builtinProviderCatalog, knownBackend } from "../../../../shared/providers/catalog";
import { configureRuntimeVersionCache } from "../../backends/runtime/runtime-version-cache";
import { RuntimeSnapshotStore } from "./runtime-snapshot-store";
import { startupTrace } from "./startup-trace";

/**
 * Last launch's confirmed Agents open the renderer gate on its first render; this
 * launch's discovery is what keeps that ledger honest, so it subscribes before the
 * warm-up call rather than sampling afterwards.
 */
export function warmAgentDiscovery(userData: string, defaultBackend: AgentBackendId): Promise<BackendInfo[]> {
  // Before the first probe: a file already answered in a previous launch is not asked `--version` again (C-10).
  configureRuntimeVersionCache(join(userData, "runtime-versions.json"));
  const runtimeSnapshots = new RuntimeSnapshotStore(userData);
  const provisionalBackends = runtimeSnapshots.provisionalBackends(
    (backend) => backendById(backend).displayName
  );
  /* The launch snapshot restores built-ins only: a package Provider's facts wait for this launch's catalog and discovery. */
  backendRuntimeRegistry.subscribe((id, snapshot) => {
    const backend = knownBackend(builtinProviderCatalog, id);
    if (!backend) return;
    if (snapshot.runtimeStatus === "installed") {
      void runtimeSnapshots.record(backend, {
        executable: snapshot.runtime.executable,
        version: snapshot.runtime.version,
        capabilities: snapshot.capabilities,
      });
    } else if (snapshot.runtimeStatus === "missing") {
      void runtimeSnapshots.forget(backend);
    }
  });
  /* Only the Agent the first message goes to is discovered at launch; the rest when the Agent menu, Settings or
     Onboarding asks (OPT-20, ruled 2026-09-25). */
  void backendRuntimeRegistry.resolve(defaultBackend).catch(() => undefined);
  startupTrace.mark("discovery:warm-start");
  return provisionalBackends;
}

/** The settings envelope is read when a window is created, never when the launcher is built. */
export function startupSnapshotLauncher(
  settings: () => SettingsEnvelope,
  backends: BackendInfo[]
) {
  return () => {
    const built = startupSnapshotArgument({
      settings: settings(),
      setup: { backends },
    });
    startupTrace.mark(
      "snapshot:ready",
      `${built.encodedLength}B backends=${backends.length}${built.dropped ? ` dropped=${built.dropped}` : ""}`
    );
    if (built.dropped) console.warn(`[startup] snapshot exceeds the launch-argument budget; dropped ${built.dropped}`);
    return built.launchArguments;
  };
}
