/**
 * [INPUT]: Depends on Memory settings, target, durable consent policy and the existing pause/resume controller.
 * [OUTPUT]: Provides reconcilePluginConsent, restoring live authority only within the previously authorized target and scope.
 * [POS]: Memory service reconciliation shared by settings application, startup recovery and retries; no additional persisted state.
 */
import type { MemorySettings } from "../../../../../shared/ipc/settings/settings-ipc";
import type { MemoryEffectiveTarget } from "../../../../../shared/ipc/content/memory-ipc";
import type { MemoryPolicyStore } from "../../policy/store";
import type { MemoryPauseController } from "../../orchestration/pause-controller";

export async function reconcilePluginConsent(input: {
  memory: MemorySettings;
  target: MemoryEffectiveTarget;
  policy: MemoryPolicyStore;
  control: MemoryPauseController;
  destination(): Promise<{ hostname: string; model: string }>;
}) {
  const { memory, target, policy, control } = input;
  if (!memory.enabled) return;
  const live = policy.activeConsent();
  if (!memory.pluginEnabled || memory.paused) {
    if (live) await control.pause();
    return;
  }
  if (live) return;
  const previous = policy.currentConsent() ?? policy.latestLiveConsent();
  // A saved preference alone never substitutes for an explicitly granted authority.
  if (!previous) return;
  if (!target.canEnable) throw new Error("backend-unavailable");
  const destination = await input.destination();
  if (previous.providerId !== target.providerId || previous.providerDataInstanceId !== target.providerDataInstanceId ||
      previous.sharingMode !== memory.sharingMode || previous.sharingGeneration !== policy.snapshot().state.sharingGeneration ||
      previous.extractionHostname !== destination.hostname || previous.extractionModel !== destination.model) {
    throw new Error("memory-consent-required");
  }
  await control.resume(target, memory.sharingMode);
}
