"use client";

/**
 * [INPUT]: Depends on router, Projects provider, the shared instructions editor section, page shell, and i18n
 * [OUTPUT]: Provides ProjectInstructionsView — the /projects/:projectId/instructions route with a back arrow to the previous route
 * [POS]: Full-width editor destination opened from the Project Settings pane; keeps draft/save/workspace-changed behaviour
 */

import { Navigate, useNavigate, useParams } from "react-router";

import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { ProjectInstructionsSection } from "@/components/settings/project/project-instructions-section";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { draftRoute, projectAlive } from "@/lib/chat/drafts/draft-route";
import { WorkspaceBackLink } from "@ai-chat/ui/components/workspace/page";

export function ProjectInstructionsView() {
  const { t } = useAppTranslation();
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { projects, loading } = useProjects();
  const project = projects.find((candidate) => candidate.id === projectId);

  if (loading) {
    return (
      <SettingsPage width="full" title={<span aria-hidden className="inline-block h-4 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}>
        <SettingsCanvas><div className="h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" /></SettingsCanvas>
      </SettingsPage>
    );
  }
  if (!project || !projectAlive(project)) return <Navigate to="/" replace />;

  /* Back returns to the route the person came from; a cold-opened editor has
     no previous entry, so it lands on the project draft instead. */
  const back = () => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) void navigate(-1);
    else void navigate(draftRoute(project.id));
  };

  return (
    <SettingsPage
      headingPlacement="page"
      leading={
        <WorkspaceBackLink aria-label={t("common.back")} onClick={back} />
      }
      title={t("projectSettings.instructions.section")}
      width="full"
    >
      <ProjectInstructionsSection bare project={project} />
    </SettingsPage>
  );
}
