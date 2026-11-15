"use client";

/**
 * [INPUT]: Depends on router, Projects provider, the ProjectSettingsPane navigation state, draft routing, and i18n
 * [OUTPUT]: Provides ProjectSettingsView — the /projects/:projectId/settings alias that opens the pane, maps ?tab to focus, then restores the previous route
 * [POS]: Deep-link shim only; Project Settings content lives in the pane and the instructions route
 */

import { useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { useProjects } from "@/components/providers/projects-provider";
import {
  useProjectSettingsPane,
  type ProjectSettingsPaneFocus,
} from "@/components/providers/navigation/project-settings-pane";
import { draftRoute, projectAlive } from "@/lib/chat/drafts/draft-route";

const tabFocus = (tab: string | null): ProjectSettingsPaneFocus => {
  if (tab === "skills" || tab === "extensions") return "skills";
  if (tab === "personalization" || tab === "instructions") return "instructions";
  if (tab === "apps") return "apps";
  if (tab === "base") return "base";
  return "general";
};

export function ProjectSettingsView() {
  const { projectId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useProjectSettingsPane();
  const { projects, loading } = useProjects();
  const project = projects.find((candidate) => candidate.id === projectId);

  /* Deep links stay valid: the alias opens the pane with the mapped focus,
     then replaces itself with the previous non-settings route — or the
     project draft, or / — so history never keeps a settings entry. */
  /* 别名是一次性翻译：打开 pane、换掉路由之后，本组件的使命就结束了。
     ref 挡掉 provider 值变化引发的重放，pane 本身只由这一次决定。 */
  const handled = useRef(false);
  useEffect(() => {
    if (loading || handled.current) return;
    handled.current = true;
    if (!project || !projectAlive(project)) {
      void navigate("/", { replace: true });
      return;
    }
    navigation?.open({
      projectId: project.id,
      focus: tabFocus(searchParams.get("tab")),
      packageFilter: searchParams.get("package") ?? undefined,
    });
    void navigate(navigation?.restoreTarget() ?? draftRoute(project.id), { replace: true });
  }, [loading, project, navigate, navigation, searchParams]);

  return null;
}
