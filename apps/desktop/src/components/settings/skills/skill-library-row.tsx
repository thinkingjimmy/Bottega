/**
 * [INPUT]: Depends on Library-first Skill rows, main-authored allowedActions, shared SkillRow/SkillBadge presentation, i18n, SettingsSwitch, and compact action buttons
 * [OUTPUT]: Provides one accessible Skill row with name/description/source, content presence, cross-device conversion notice, selection, one enabled switch, delete, and package navigation
 * [POS]: Global Skills management adapter for SkillRow; it never infers actions from source kind or filesystem state
 */

import { ExternalLink, Trash2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsSwitch } from "@/components/settings/settings-layout";
import { SkillBadge, SkillRow } from "./skill-row";
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
    <SkillRow
      name={skill.displayName}
      description={skill.description}
      selection={(
        <label className="grid size-11 shrink-0 place-items-center">
          <input
            aria-label={t("settings.skills.selectSkill", { name: skill.displayName })}
            checked={selected}
            className="size-4 accent-foreground"
            disabled={busy}
            onChange={(event) => onSelected(event.target.checked)}
            type="checkbox"
          />
        </label>
      )}
      badges={(
        <>
          <SkillBadge>
            {t(`settings.skills.sourceKind.${skill.source.kind}`)}
          </SkillBadge>
          {skill.contentState !== "ready" && (
            <SkillBadge>
              {t(`settings.skills.contentState.${skill.contentState}`)}
            </SkillBadge>
          )}
          {skill.notice === "slug-conflict" && (
            <SkillBadge>
              {t("settings.skills.noticeSlugConflict")}
            </SkillBadge>
          )}
        </>
      )}
      actions={(
        <>
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
        </>
      )}
    />
  );
}
