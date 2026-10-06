/**
 * [INPUT]: Depends on current Memory service, settings and managed runtime facts, and backend descriptors.
 * [OUTPUT]: Provides read-only memoryPluginHealth with plugin suspension and durable application failures; failed runtime reads use the catalog's unknown-health fallback.
 * [POS]: Keeps backend readiness separate from the Memory plugin's user-controlled switch.
 */
import type { PluginHealth } from "@bottega/contracts/plugins/catalog";
import type { MemoryPluginPorts } from "./owner";
import { memoryModule } from "../providers/registry";
import { memoryPluginText as copy } from "./descriptor";

export async function memoryPluginHealth(ports: MemoryPluginPorts): Promise<PluginHealth> {
  const memory = ports.settings.get().memory;
  const status = ports.service.status();
  const runtime = await ports.runtimes.get(memory.provider)?.snapshot();
  const descriptor = memoryModule(memory.provider)?.descriptor;
  const state = !ports.platformSupport.capabilities.memory ? "unsupported" : !runtime?.installed ? "missing"
    : !runtime.configured ? "configuration" : runtime.configIssue || runtime.phase === "failed" || memory.applyStatus || status.health === "unavailable" ? "repair"
    : !memory.enabled ? "off" : !memory.pluginEnabled || memory.paused ? "paused" : status.health === "unknown" || status.health === "checking" ? "checking" : "ready";
  const facts: PluginHealth["facts"] = [
    { label: copy("health.backend"), value: { text: descriptor?.displayName ?? memory.provider } },
    { label: copy("health.version"), value: runtime?.installedVersion ? { text: runtime.installedVersion } : copy("health.unknown") },
    { label: copy("health.sharing"), value: copy(`sharing.${memory.sharingMode}`) },
    { label: copy("health.service"), value: copy(`health.${state}`) },
  ];
  const root = runtime?.dataRoot;
  if (root) facts.push({ label: copy("health.directory"), value: { text: root.slice(0, 512) } });
  return { level: ["unsupported", "missing", "configuration", "repair"].includes(state) ? "attention" : state === "checking" ? "unknown" : "ok",
    summary: copy(`health.${state}`), facts, checkedAt: Date.now() };
}
