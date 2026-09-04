"use client";

/**
 * [INPUT]: Depends on Apps v5 record, Apps i18n, and app workspace bindings from ProjectsProvider
 * [OUTPUT]: Provides useAppBase, which stably parses Base App to the exclusive Project and project ownerKey
 * [POS]: The Base ownership leaf of components/apps/surface, consumed by detail/base-app-detail; The Project/Base relationship is not self-guided
 */

import { useMemo } from "react";
import type { AppRecord } from "../../../../shared/apps-ipc";
import { useProjects } from "@/components/providers/projects-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function useAppBase(record: AppRecord) {
  const { t } = useAppTranslation();
  const { loading, projects } = useProjects();
  /* 绑定关系只跟 Project 列表与这只 App 走：这只 hook 挂在每一张 App 卡上，
     不 memo 就是「卡片数 × Project 数」次扫描，还每次都换一个新的 project 身份，
     把下游的 memo 一并作废。 */
  const project = useMemo(
    () =>
      projects.find(
        (candidate) =>
          candidate.workspaceBinding.kind === "app" &&
          candidate.workspaceBinding.appId === record.id
      ),
    [projects, record.id]
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
