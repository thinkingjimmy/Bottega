/**
 * [INPUT]: Memory service status, the single Memory settings owner and the local facade preference.
 * [OUTPUT]: Narrow remote status/control port without enable, consent, backend or destructive capabilities.
 * [POS]: Startup adapter between local Memory ownership and encrypted remote intent delivery.
 */
import type { MemoryService } from "../memory-service";
import type { MemorySettingsOwner } from "../settings-owner";
import type { SettingsStore } from "../../../settings/settings-store";
export function memoryRemoteControl(service: MemoryService | null | undefined, owner: MemorySettingsOwner | null | undefined, settings: SettingsStore) {
  if (!service || !owner) return undefined;
  return { status: () => service.status(), onStatus: (listener: () => void) => service.onStatus(listener),
    facadeEnabled: () => settings.get().memoryPhoneFacade, applyPaused: (input: { operationId: string; paused: boolean; current(): void }) => owner.setPausedRemote(input) };
}
