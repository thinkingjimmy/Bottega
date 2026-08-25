"use client";

/**
 * [INPUT]: Depends on Apps v5 record and app workspace binding from ProjectsProvider
 * [OUTPUT]: Provides useAppBase, which stably parses Base App to the exclusive Project and project ownerKey
 * [POS]: The Base ownership of the apps module is the adaptive leaf; The Project/Base relationship is not self-guided
 */

import type { AppRecord } from "../../../shared/apps-ipc";
import { useProjects } from "@/components/providers/projects-provider";

export function useAppBase(record: AppRecord) {
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
        ? "Base App 缺少专属 Project，请重新打开或从 Apps 页重试"
        : "",
  };
}
