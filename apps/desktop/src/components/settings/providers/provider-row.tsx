/**
 * [INPUT]: Depends on dnd-kit sortable, the Setup presentation projection, Agent identity, Settings layout primitives and Providers i18n
 * [OUTPUT]: Provides ProviderRow with one line for identity, reordering, setup or update actions, and the default control; providerHealth supplies diagnostic copy to plugin settings and action eligibility to the list.
 * [POS]: Row of Settings › Providers; ProviderList owns ordering and persistence. A package Provider can be made default once Setup reports it installed and supported.
 */

import { useSortable } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsBadge, SettingsButton } from "@/components/settings/settings-layout";
import { backendSetupPresentation } from "@/components/setup/backend-parts";
import { providerTraits } from "../../../../shared/providers/traits";
import { AgentBackendIcon, isAgentBackendId, providerName } from "@/lib/agent/agent-backends";
import type { ProviderEntry } from "@/lib/provider-catalog/store";
import type { BackendInfo } from "../../../../shared/ipc/agent/agent-ipc";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";

export type ProviderFix = "setup" | "update";

const UNVERIFIED_REASON_KEYS = {
  "provider-scoped": "agentAvailability.unverifiedReason.provider-scoped",
  "not-supported": "agentAvailability.unverifiedReason.not-supported",
} as const;

export function providerHealth(backend: BackendInfo | undefined, now: number) {
  if (!backend) return { noteKey: null, fix: null, selectable: true } as const;
  const presentation = backendSetupPresentation(backend, now);
  const fix: ProviderFix | null = presentation.requiresUpdate ? "update"
    : presentation.tone === "attention" ? "setup" : null;
  /* A custom route explains itself; "Not verified" says why when the registry knows (TASK-13 E). */
  const reason = backend.availability?.authUnknownReason;
  return {
    noteKey: presentation.tone === "attention" ? presentation.labelKey
      : presentation.status === "custom-route" ? "agentAvailability.customRoute"
      : presentation.status === "installed" && (reason === "provider-scoped" || reason === "not-supported") ? UNVERIFIED_REASON_KEYS[reason]
      : providerTraits(backend.id).isolatedConfig ? "agentAvailability.isolatedConfig"
      : null,
    fix,
    /* Only a CLI that is not there at all, or too old to run, cannot be where new Chats start. */
    selectable: backend.runtimeStatus !== "missing" && backend.runtimeStatus !== "unsupported",
  } as const;
}

export function ProviderRow({ entry, backend, isDefault, now, onMakeDefault, onFix }: {
  entry: ProviderEntry;
  backend?: BackendInfo;
  isDefault: boolean;
  now: number;
  onMakeDefault(provider: ProviderId): void;
  onFix(fix: ProviderFix): void;
}) {
  const { t } = useAppTranslation();
  const id = entry.id;
  /* New Chats may start on any Provider this computer can run: a built-in as before, a package Provider once Setup reports it
     (installed and supported, the built-ins' own rule). Read back as stored while the catalog lists it available (S3-d). */
  const canDefault = entry.available && (isAgentBackendId(id) || Boolean(backend));
  /* Every row moves: S3-c keeps any id in the order. */
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const name = backend?.displayName ?? providerName(entry);
  const { fix, selectable } = providerHealth(backend, now);
  return <div ref={setNodeRef} role="group" aria-label={name}
    style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
    className={cn("relative flex min-h-14 items-center gap-3 bg-card px-4 py-3", isDragging && "z-10 shadow-md ring-1 ring-foreground/10")}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners}
      aria-label={t("settings.providers.reorder", { name })}
      className="-ml-1 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing">
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
    <AgentBackendIcon backend={id} className="size-5 shrink-0" />
    <span className="min-w-0 flex-1 truncate font-medium text-sm">{name}</span>
    <div className="flex shrink-0 items-center gap-2">
      {fix && <SettingsButton variant="outline" onClick={() => onFix(fix)}>
        {t(fix === "update" ? "settings.providers.update" : "settings.providers.setUp")}
      </SettingsButton>}
      {isDefault ? <SettingsBadge tone="muted">{t("settings.providers.default")}</SettingsBadge>
        : <SettingsButton variant="ghost" disabled={!canDefault || !selectable} onClick={() => onMakeDefault(id)}>{t("settings.providers.makeDefault")}</SettingsButton>}
    </div>
  </div>;
}
