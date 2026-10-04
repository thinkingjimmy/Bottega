/**
 * [INPUT]: Depends on revision-checked MemorySettingsOwner mutations, original MemoryService consent and adapter field validation.
 * [OUTPUT]: Provides createMemorySettingsAdapter with single-use, patch-bound and revision-bound consent confirmations.
 * [POS]: Bridges declarative plugin settings to the existing Memory owners without a second settings store.
 */
import { randomUUID } from "node:crypto";
import { checkSettingValue, type SettingsAdapter, type SettingValue } from "@bottega/contracts/plugins/settings";
import type { MemoryConsentPreview } from "../../../../shared/ipc/content/memory-ipc";
import type { MemorySharingMode } from "../../../../shared/ipc/settings/settings-ipc";
import type { SettingsStore } from "../../settings/settings-store";
import type { MemorySettingsOwner } from "../service/settings-owner";
import type { MemoryService } from "../service/memory-service";
import { memoryPluginFields, memoryPluginText } from "./descriptor";

export type MemorySettingsAdapterPorts = { settings: SettingsStore; settingsOwner: MemorySettingsOwner; service: MemoryService };
type Pending = { field: string; value: SettingValue; revision: number; expiresAt: number; preview: MemoryConsentPreview };
const refused = (code: string) => ({ status: "refused" as const, code });

export function createMemorySettingsAdapter(ports: MemorySettingsAdapterPorts): SettingsAdapter {
  const pending = new Map<string, Pending>();
  return {
    async read() {
      const settings = ports.settings.get();
      return { backend: settings.memory.provider, "sharing-mode": settings.memory.sharingMode, "phone-facade": settings.memoryPhoneFacade,
        "workflow-roles": settings.memoryWorkflowRoles };
    },
    async submit(patch, confirmation) {
      const entries = Object.entries(patch);
      const answer = confirmation ? pending.get(confirmation) : undefined;
      if (confirmation) pending.delete(confirmation);
      if (entries.length !== 1) return refused("setting-invalid");
      const [id, value] = entries[0]!;
      const field = memoryPluginFields.find(item => item.id === id);
      if (!field || checkSettingValue(field, value)) return refused("setting-invalid");
      const envelope = ports.settings.envelope();
      if (confirmation && (!answer || answer.field !== id || answer.value !== value || answer.revision !== envelope.revision || answer.expiresAt < Date.now())) {
        return refused("memory-confirmation-stale");
      }
      if (id === "phone-facade") {
        await ports.settingsOwner.setPhoneFacade(value as boolean);
        return { status: "applied" };
      }
      if (id === "workflow-roles") {
        await ports.settingsOwner.setWorkflowRoles(value as boolean);
        return { status: "applied" };
      }
      const current = envelope.settings.memory;
      if (!current.enabled) return refused("plugin-setup-required");
      if ((id === "backend" ? current.provider : current.sharingMode) === value) return { status: "applied" };
      const provider = id === "backend" ? value as string : current.provider;
      const mode = id === "sharing-mode" ? value as MemorySharingMode : current.sharingMode;
      const reason = id === "backend" ? "cutover" : "sharing";
      if (!answer) {
        const preview = await ports.service.previewConsent(provider, false, reason, mode);
        const token = randomUUID();
        for (const [key, entry] of pending) if (entry.expiresAt < Date.now()) pending.delete(key);
        if (pending.size >= 16) pending.delete(pending.keys().next().value!);
        pending.set(token, { field: id, value, revision: envelope.revision, expiresAt: Date.now() + 300_000, preview });
        return { status: "confirm", confirmation: { id: token, title: memoryPluginText("confirmation.title"),
          body: { ...memoryPluginText(`confirmation.${reason === "sharing" ? mode : "cutover"}`), params: { hostname: preview.hostname, model: preview.model } }, danger: false } };
      }
      const authority = await ports.service.requestConsent(provider, false, reason, mode, answer.preview.digest);
      try {
        await ports.settingsOwner.mutate(id === "backend"
          ? { kind: "cutover-with-consent", providerId: provider, authorityToken: authority.token }
          : { kind: "set-sharing-with-consent", sharingMode: mode, authorityToken: authority.token }, answer.revision);
      } catch (cause) {
        if (cause instanceof Error && cause.message === "memory-confirmation-stale") return refused(cause.message);
        throw cause;
      }
      return { status: "applied" };
    },
  };
}
