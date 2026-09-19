/**
 * [INPUT]: Depends on Project identity, URL search params, shared Skills toolbar/import controls, the Project callable catalog, and scoped Extensions content
 * [OUTPUT]: Provides ProjectSkillsSettings with nested Skills/Extensions tabs and both acquisition actions in the shared toolbar
 * [POS]: Project Settings Skills surface; Library imports are global and Extension installation retains exact Project authority
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";
import type { Project } from "../../../../../shared/projects-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { SkillImportDialog } from "@/components/settings/skills/skill-import-dialog";
import { SkillsToolbar } from "@/components/settings/skills/controls/toolbar";
import { useSkillImport } from "@/components/settings/skills/controls/use-skill-import";
import { ExtensionsContent } from "@/views/settings-extensions";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Tabs, TabsContent } from "@ai-chat/ui/components/ui/tabs";
import { ProjectSkillsSection } from "../project-skills-section";

export function ProjectSkillsSettings({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "extensions" ? "extensions" : "skills";
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const [importRevision, setImportRevision] = useState(0);
  const scope = useMemo(() => ({ kind: "project" as const, projectId: project.id }), [project.id]);
  const skillImport = useSkillImport({
    onImported: () => setImportRevision((revision) => revision + 1),
  });

  return (
    <Tabs
      className="h-full min-h-0 gap-0"
      onValueChange={(value) => setParams({ tab: value }, { replace: false })}
      value={tab}
    >
      <SettingsCanvas>
        <SkillsToolbar actionHostRef={setActionHost}>
          {tab === "skills" && (
            <Button disabled={skillImport.busy} onClick={() => void skillImport.openDialog()} size="lg">
              <Plus />
              {t("settings.skills.importTitle")}
            </Button>
          )}
        </SkillsToolbar>
        <TabsContent className="mt-0" value="skills">
          <ProjectSkillsSection project={project} refreshRevision={importRevision} />
        </TabsContent>
        <TabsContent className="mt-0" value="extensions">
          <ExtensionsContent
            description={t("projectSettings.extensions.scopeNote")}
            packageIdentity={params.get("package")}
            projectLifecycleRevision={project.projectLifecycleRevision}
            scope={scope}
            toolbarActionHost={actionHost}
          />
        </TabsContent>
      </SettingsCanvas>
      <SkillImportDialog {...skillImport.dialogProps} />
    </Tabs>
  );
}
