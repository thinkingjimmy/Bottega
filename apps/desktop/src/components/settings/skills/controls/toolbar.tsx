/**
 * [INPUT]: Depends on React nodes, shared Tabs primitives, and Skills translations
 * [OUTPUT]: Provides SkillsToolbar with shared segmented tabs and a stable acquisition-action host
 * [POS]: Common toolbar for global and Project Skills settings; the surrounding Tabs owns navigation
 */

import type { ReactNode, Ref } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";

export function SkillsToolbar({
  actionHostRef,
  children,
}: {
  actionHostRef: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="mb-4 flex items-center gap-2" data-testid="settings-skills-toolbar">
      <TabsList>
        <TabsTrigger value="skills">{t("settings.skills.tabs.skills")}</TabsTrigger>
        <TabsTrigger value="extensions">{t("settings.skills.tabs.extensions")}</TabsTrigger>
      </TabsList>
      <div className="ml-auto" ref={actionHostRef}>{children}</div>
    </div>
  );
}
