"use client";

/**
 * [INPUT]: Depends on Apps v5 record, Apps i18n, and app workspace bindings from ProjectsProvider
 * [OUTPUT]: Provides useAppBase, which stably parses Base App to the exclusive Project and project ownerKey
 * [POS]: The Base ownership of the apps module is the adaptive leaf; The Project/Base relationship is not self-guided
 */

import type { AppRecord } from "../../../shared/apps-ipc";
import { useProjects } from "@/components/providers/projects-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function useAppBase(record: AppRecord) {
  const { t } = useAppTranslation();
  const { loading, projects } = useProjects();
  const project = projects.find(
    (candidate) =>
      candidate.workspaceBinding.kind === "app" &&
      candidate.workspaceBinding.appId === record.id
  );
  return {
    loading,
    project,
    ownerKey: project ? `project:${project.id}` : "",
    error:
      !loading && !project
        ? t("apps.baseDetail.missingProject")
        : "",
  };
}
