"use client";

/**
 * [INPUT]: Depends on shared Project contract, AppDialog/Dialog primitives, i18n, and ProjectAppGrantsPanel
 * [OUTPUT]: Provides ProjectAppGrantsDialog as a modal shell around the shared grants panel
 * [POS]: Sidebar Project grant entry; mutation/catalog truth remains in the shared panel and Providers
 */

import type { Project } from "../../../../../shared/projects-ipc";
import { AppDialogBody, AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ProjectAppGrantsPanel } from "./project-app-grants-panel";

export function ProjectAppGrantsDialog({ project, open, onOpenChange }: {
  project: Project;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useAppTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent className="sm:max-w-xl">
        <DialogHeader className="shrink-0 gap-0 text-left">
          <DialogTitle>{t("projects.grants.title")}</DialogTitle>
          <DialogDescription className="mt-2">{t("projects.grants.description")}</DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-4">
          <ProjectAppGrantsPanel project={project} />
        </AppDialogBody>
      </AppDialogContent>
    </Dialog>
  );
}
