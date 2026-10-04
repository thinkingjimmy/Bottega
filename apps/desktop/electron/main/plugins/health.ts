/**
 * [INPUT]: Depends on the plugin health shape and the catalog's PluginEntry.
 * [OUTPUT]: Provides pluginHealth: a plugin's health for its detail page — a Provider from its runtime snapshot (CLI installed and version,
 *           sign-in), a host package from whether its host runs, Workflow from its running runs, Base as always ready.
 * [POS]: The main-side `health(pluginId)` port of appendix C.3; the renderer's Provider detail adds its own providerHealth and CLI update row
 *        on top. Memory, Tunnel and Dock provide theirs through BuiltinOwner.health.
 */
import type { PluginHealth } from "@bottega/contracts/plugins/catalog";
import type { PluginEntry } from "./describe";

type ProviderSnapshot = Readonly<{ runtimeStatus: string; authStatus: string; runtime?: { version: string } }>;
export type HealthPorts = Readonly<{
  now: number;
  provider(providerId: string): ProviderSnapshot | null | undefined;
  packageRunning(installIdentity: string): boolean;
  workflow(): { running: number } | null;
}>;

const key = (name: string, params?: Record<string, string | number>) => (params ? { key: `plugins.health.${name}`, params } : { key: `plugins.health.${name}` });

export async function pluginHealth(entry: PluginEntry, ports: HealthPorts): Promise<PluginHealth | null> {
  const { descriptor } = entry;
  if (descriptor.source === "agent-native") {
    return { level: entry.enabled ? "ok" : "attention", summary: key(entry.enabled ? "nativeEnabled" : "nativeDisabled", { agent: entry.managedBy ?? "" }), facts: [], checkedAt: ports.now };
  }
  if (descriptor.source === "package") {
    const running = ports.packageRunning(descriptor.id);
    return { level: entry.enabled ? "ok" : "unknown", summary: key(!entry.enabled ? "off" : running ? "running" : "idle"),
      facts: [{ label: key("process"), value: key(running ? "processRunning" : "processIdle") }], checkedAt: ports.now };
  }
  if (descriptor.kind === "provider") {
    const snapshot = ports.provider(descriptor.id);
    if (!snapshot) return { level: "unknown", summary: key("notChecked"), facts: [], checkedAt: null };
    const installed = snapshot.runtimeStatus === "installed";
    const signedIn = snapshot.authStatus === "authenticated";
    const level = !installed ? (snapshot.runtimeStatus === "unknown" ? "unknown" : "error") : snapshot.authStatus === "unauthenticated" ? "attention" : "ok";
    return {
      level, summary: key(!installed ? `cli.${snapshot.runtimeStatus}` : signedIn ? "ready" : `auth.${snapshot.authStatus}`),
      facts: [
        { label: key("cliVersion"), value: snapshot.runtime ? { text: snapshot.runtime.version } : key(`cli.${snapshot.runtimeStatus}`), level: installed ? "ok" : "error" },
        { label: key("signIn"), value: key(`auth.${snapshot.authStatus}`), ...(signedIn ? { level: "ok" as const } : snapshot.authStatus === "unauthenticated" ? { level: "attention" as const } : {}) },
      ],
      checkedAt: ports.now,
    };
  }
  if (descriptor.id === "workflow") {
    const runs = ports.workflow();
    return { level: entry.enabled ? "ok" : "unknown", summary: key(entry.enabled ? "ready" : "off"),
      facts: runs ? [{ label: key("runningRuns"), value: { text: String(runs.running) } }] : [], checkedAt: ports.now };
  }
  if (descriptor.id === "base") return { level: "ok", summary: key("ready"), facts: [], checkedAt: ports.now };
  return null;
}
