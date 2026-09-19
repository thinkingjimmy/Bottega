"use client";
/**
 * [INPUT]: Native locale and shared Project appearance presentation.
 * [OUTPUT]: Localized ProjectAppearancePicker and ProjectAppearancePanel adapters.
 * [POS]: Native sidebar/settings boundary; shared UI owns draft, geometry and commit behavior.
 */
import type { ComponentProps } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ProjectAppearancePicker as Picker, ProjectAppearancePanel as Panel } from "@ai-chat/ui/components/workspace/actions/appearance";
import type { projectActionCopy } from "@ai-chat/ui/components/workspace/actions/project-copy";
import { PROJECT_COLORS, PROJECT_ICONS } from "@ai-chat/ui/components/workspace/navigation/appearance";
type AppearanceCopy = ReturnType<typeof projectActionCopy>["appearance"];
function useAppearanceCopy(): AppearanceCopy {
  const { t } = useAppTranslation();
  return {
    trigger: t("projects.appearance.trigger", { name: "{{name}}" }),
    colorGroup: t("projects.appearance.colorGroup"), iconGroup: t("projects.appearance.iconGroup"), done: t("projects.appearance.done"),
    color: Object.fromEntries(PROJECT_COLORS.map(color => [color.id, t(`projects.appearance.color.${color.id}`)])) as AppearanceCopy["color"],
    icon: Object.fromEntries(PROJECT_ICONS.map(icon => [icon.id, t(`projects.appearance.icon.${icon.id}`)])) as AppearanceCopy["icon"],
  };
}
export function ProjectAppearancePicker(props: Omit<ComponentProps<typeof Picker>, "copy">) {
  return <Picker {...props} copy={useAppearanceCopy()} />;
}
export function ProjectAppearancePanel(props: Omit<ComponentProps<typeof Panel>, "copy">) {
  return <Panel {...props} copy={useAppearanceCopy()} />;
}
