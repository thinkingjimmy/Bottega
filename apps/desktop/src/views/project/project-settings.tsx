"use client";

/**
 * [INPUT]: Depends on router, Projects and Chats providers, Project sections, SettingsPage, tab navigation, and i18n
 * [OUTPUT]: Provides Project Settings with a persistent heading and retained General, Personalization, and Skills panels
 * [POS]: apps/desktop/src/views/project; The sole `/projects/:projectId/settings` route; keeps the application Sidebar in Library context
 */

import { Navigate, useParams, useSearchParams } from "react-router";

import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useChats } from "@/components/providers/chats-provider";
import { ProjectGeneralSection } from "@/components/settings/project/project-general-section";
import { ProjectInstructionsSection } from "@/components/settings/project/project-instructions-section";
import { ProjectSkillsSettings } from "@/components/settings/project/skills/settings";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { draftRoute, projectAlive } from "@/lib/chat/drafts/draft-route";
import {
  Tabs,
  TabsTrigger,
} from "@ai-chat/ui/components/ui/tabs";
import { AnimatedTabsList, RetainedTabsContent } from "@ai-chat/ui/components/ui/navigation/tabs-motion";

const PROJECT_TABS = [
  "general",
  "personalization",
  "skills",
] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

const validTab = (value: string | null): ProjectTab =>
  value === "extensions" ? "skills"
    : PROJECT_TABS.includes(value as ProjectTab) ? value as ProjectTab : "general";

export function ProjectSettingsView() {
  const { t } = useAppTranslation();
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, loading } = useProjects();
  const { chats } = useChats();
  const project = projects.find((candidate) => candidate.id === projectId);
  const tab = validTab(searchParams.get("tab"));

  if (loading) {
    return (
      <SettingsPage width="full" title={<span aria-hidden className="inline-block h-4 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}>
        <SettingsCanvas><div className="h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" /></SettingsCanvas>
      </SettingsPage>
    );
  }
  if (!project || !projectAlive(project)) return <Navigate to="/" replace />;

  const projectChats = chats.filter(
    (chat) => chat.projectId === project.id && !chat.effectiveArchived
  );
  // Navigation stays outside panel lifetimes.
  return (
    <Tabs
      key={project.id}
      className="flex h-full min-h-0 flex-col gap-0"
      value={tab}
      onValueChange={(value) => setSearchParams({ tab: value }, { replace: false })}
    >
      <SettingsPage
        width="full"
        headingPlacement="page"
        backHref={draftRoute(project.id)}
        rail={
          <div className="mx-3 overflow-x-auto">
            <AnimatedTabsList value={tab} className="flex w-max min-w-full justify-start border-b border-border group-data-horizontal/tabs:h-10">
              {PROJECT_TABS.map((value) => (
                <TabsTrigger className="flex-none cursor-pointer px-3" key={value} value={value}>
                  {t(`projectSettings.tabs.${value}`)}
                </TabsTrigger>
              ))}
            </AnimatedTabsList>
          </div>
        }
        title={t("projectSettings.title", { name: project.name })}
      >
        <RetainedTabsContent className="h-full" value="general" active={tab === "general"}>
          <ProjectGeneralSection key={project.id} chats={projectChats} project={project} />
        </RetainedTabsContent>
        <RetainedTabsContent className="h-full" value="personalization" active={tab === "personalization"}>
          <ProjectInstructionsSection key={project.id} project={project} />
        </RetainedTabsContent>
        <RetainedTabsContent className="h-full" value="skills" active={tab === "skills"}>
          <ProjectSkillsSettings key={project.id} project={project} />
        </RetainedTabsContent>
      </SettingsPage>
    </Tabs>
  );
}
