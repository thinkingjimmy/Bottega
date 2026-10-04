/**
 * [INPUT]: Depends on an explicitly allocated App identity and local maintenance Agent choice.
 * [OUTPUT]: Creates an unprivileged installation shell with no manifest, generation, session or grant. Seeds enabled Apps at revision zero.
 * [POS]: Shared App delivery initializer; executable authority is issued only by the existing generation pipeline.
 */
import type { AppRecord } from "../../../../../shared/ipc/apps/apps-ipc";
export function installationRecord(input: Pick<AppRecord, "id" | "dir" | "displayName" | "agent" | "origin" | "sourceRepoUrl"> &
  Pick<Partial<AppRecord>, "presetId" | "installedPresetPin">): AppRecord {
  return { ...input, enabled: true, enabledRevision: 0, publishedRepoUrl: null, state: "creating", lastError: null, agentWarning: null,
    maintenanceAgent: input.agent, headlessConsent: null, bindingRevision: 0, lifecycleRevision: 0,
    defaultGrant: null, defaultGrantRevision: 0, studioGrant: null, studioGrantRevision: 0, pinnedAt: null,
    domainIdentity: null, generations: [], generationBinding: { bindingRevision: 0, active: null, drainingGenerationIds: [] },
    manifest: null, editChatSlot: null, activeUseChatSlot: null, editableSource: true, skillStatus: null, addedAt: Date.now() };
}
