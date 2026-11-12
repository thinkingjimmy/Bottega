/**
 * [INPUT]: Depends on React nodes, shared Tabs primitives, and Skills and Extensions labels
 * [OUTPUT]: Provides SkillsToolbar with shared segmented tabs and an optional stable acquisition-action host
 * [POS]: Toolbar for Project Skills settings; the surrounding Tabs owns navigation
 */

import type { ReactNode, Ref } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";

export function SkillsToolbar({
  actionHostRef,
  children,
}: {
  actionHostRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="mb-4 flex items-center gap-2" data-testid="settings-skills-toolbar">
      <TabsList>
        <TabsTrigger value="skills">{t("common.skills")}</TabsTrigger>
        <TabsTrigger value="extensions">{t("settings.extensions.page.title")}</TabsTrigger>
      </TabsList>
      {(actionHostRef || children) && <div className="ml-auto" ref={actionHostRef}>{children}</div>}
    </div>
  );
}
