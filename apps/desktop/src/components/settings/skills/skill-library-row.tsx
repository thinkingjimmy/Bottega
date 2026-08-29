/**
 * [INPUT]: Depends on Library-first Skill rows, main-authored allowedActions, i18n, SettingsSwitch, and compact action buttons
 * [OUTPUT]: Provides one accessible Skill row with name/description/source, selection, one enabled switch, delete, and package navigation
 * [POS]: Sole Settings Skill row; it never infers actions from source kind or filesystem state
 */

import { ExternalLink, Trash2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsSwitch } from "@/components/settings/settings-layout";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ManagedSkillLibraryItem } from "../../../../shared/unified-skills-ipc";

export function SkillLibraryRow({
  skill,
  selected,
  busy,
  onSelected,
  onEnabled,
  onDelete,
  onGotoPackage,
}: {
  skill: ManagedSkillLibraryItem;
  selected: boolean;
  busy: boolean;
  onSelected(selected: boolean): void;
  onEnabled(enabled: boolean): void;
  onDelete(): void;
  onGotoPackage(): void;
}) {
  const { t } = useAppTranslation();
  const canEnable = skill.allowedActions.includes("enable");
  const canDisable = skill.allowedActions.includes("disable");
  return (
    <div className="grid min-h-16 grid-cols-[44px_minmax(0,1fr)_auto_auto] items-center gap-2 px-2 py-2">
      <label className="grid size-11 place-items-center">
        <input
          aria-label={t("settings.skills.selectSkill", { name: skill.displayName })}
          checked={selected}
          className="size-4 accent-foreground"
          disabled={busy}
          onChange={(event) => onSelected(event.target.checked)}
          type="checkbox"
        />
      </label>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-sm">{skill.displayName}</span>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t(`settings.skills.sourceKind.${skill.source.kind}`)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-relaxed">
          {skill.description}
        </p>
      </div>
      <SettingsSwitch
        checked={skill.enabled}
        disabled={busy || (skill.enabled ? !canDisable : !canEnable)}
        id={`skill-enabled-${skill.ref}`}
        label={t(skill.enabled ? "settings.skills.disable" : "settings.skills.enable")}
        onToggle={onEnabled}
      />
      <div className="flex items-center">
        {skill.allowedActions.includes("delete") && (
          <Button
            aria-label={t("settings.skills.delete")}
            disabled={busy}
            onClick={onDelete}
            size="icon-lg"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        )}
        {skill.allowedActions.includes("goto-package") && (
          <Button
            aria-label={t("settings.skills.gotoPackage")}
            disabled={busy}
            onClick={onGotoPackage}
            size="icon-lg"
            variant="ghost"
          >
            <ExternalLink />
          </Button>
        )}
      </div>
    </div>
  );
}
