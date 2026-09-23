/**
 * [INPUT]: Depends on dnd-kit sortable, the Setup presentation projection, Agent identity, Settings layout primitives and Providers i18n
 * [OUTPUT]: Provides ProviderRow — a sortable row with a drag handle, identity, a one-line health note with its single fix, and the Default badge or Make default action
 * [POS]: Row of Settings › Providers; ProviderList owns ordering and persistence, this file only renders one Agent
 */

import { useSortable } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsBadge, SettingsButton } from "@/components/settings/settings-layout";
import { backendSetupPresentation } from "@/components/setup/backend-parts";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import type { AgentBackendId, BackendInfo } from "../../../../shared/agent-ipc";

export type ProviderFix = "setup" | "update";

export function providerHealth(backend: BackendInfo | undefined, now: number) {
  if (!backend) return { note: null, fix: null, selectable: true } as const;
  const presentation = backendSetupPresentation(backend, now);
  const fix: ProviderFix | null = presentation.requiresUpdate ? "update"
    : presentation.tone === "attention" ? "setup" : null;
  return {
    note: presentation.tone === "attention" ? presentation.labelKey : null,
    fix,
    /* Only a CLI that is not there at all, or too old to run, cannot be where new Chats start. */
    selectable: backend.runtimeStatus !== "missing" && backend.runtimeStatus !== "unsupported",
  } as const;
}

export function ProviderRow({ id, backend, isDefault, now, onMakeDefault, onFix }: {
  id: AgentBackendId;
  backend?: BackendInfo;
  isDefault: boolean;
  now: number;
  onMakeDefault(): void;
  onFix(fix: ProviderFix): void;
}) {
  const { t } = useAppTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const name = backend?.displayName ?? backendLabel(id);
  const health = providerHealth(backend, now);
  return <div ref={setNodeRef} role="group" aria-label={name}
    style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
    className={cn("relative flex min-h-14 items-center gap-3 bg-card px-4 py-3", isDragging && "z-10 shadow-md ring-1 ring-foreground/10")}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners}
      aria-label={t("settings.providers.reorder", { name })}
      className="-ml-1 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing">
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
    <AgentBackendIcon backend={id} className="size-5 shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="truncate font-medium text-sm">{name}</p>
      {health.note && <p className="truncate text-muted-foreground text-xs">{t(health.note)}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {health.fix && <SettingsButton variant="outline" onClick={() => onFix(health.fix!)}>
        {t(health.fix === "update" ? "settings.providers.update" : "settings.providers.setUp")}
      </SettingsButton>}
      {isDefault ? <SettingsBadge tone="muted">{t("settings.providers.default")}</SettingsBadge>
        : <SettingsButton variant="ghost" disabled={!health.selectable} onClick={onMakeDefault}>{t("settings.providers.makeDefault")}</SettingsButton>}
    </div>
  </div>;
}
