"use client";

/**
 * [INPUT]: Depends on React state, Project/Chat contracts, ProjectsProvider detach mutation, archive client, optional caller-owned archive-success feedback, shared dialogs, and i18n
 * [OUTPUT]: Provides useProjectLifecycle, ProjectLifecycleDialogs, and localDetachArchiveReasons as one archive/remove state machine with an optional post-archive signal
 * [POS]: Shared Project lifecycle controller consumed by Sidebar Project rows and Project Settings General
 */

import { useState } from "react";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import type { Project, ProjectLocalDetachReason } from "../../../../shared/projects-ipc";
import { useProjects } from "@/components/providers/projects-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { archiveTargets } from "@/lib/archive-client";
import { errorMessage } from "@/lib/errors";
import { Button } from "@ai-chat/ui/components/ui/button";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";

export function localDetachArchiveReasons(input: {
  hasProjectBase: boolean;
  groupMemory: boolean;
}): ProjectLocalDetachReason[] {
  return [
    ...(input.hasProjectBase ? (["project-base"] as const) : []),
    ...(input.groupMemory ? (["group-memory"] as const) : []),
  ];
}

export function useProjectLifecycle(
  project: Project,
  options: {
    chats: ChatSummary[];
    pinnedBaseCount: number;
    hasProjectBase: boolean;
    groupMemory: boolean;
    onLeave(archiveMembers: boolean): void;
    onArchived?(): void;
  }
) {
  const { detachLocalProject } = useProjects();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [localDetachOpen, setLocalDetachOpen] = useState(false);
  const [localDetachReasons, setLocalDetachReasons] = useState<ProjectLocalDetachReason[]>([]);
  const [operationError, setOperationError] = useState("");
  const [busy, setBusy] = useState(false);

  const archive = async () => {
    setBusy(true);
    setOperationError("");
    try {
      await archiveTargets([{ kind: "project", id: project.id }]);
      options.onLeave(true);
      options.onArchived?.();
      setArchiveOpen(false);
      setLocalDetachOpen(false);
    } catch (cause) {
      setOperationError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const detachLocal = async () => {
    if (localDetachReasons.length) {
      await archive();
      return;
    }
    setBusy(true);
    setOperationError("");
    try {
      const result = await detachLocalProject(project.id);
      if (result.status === "archive-required") {
        setLocalDetachReasons(result.reasons);
        return;
      }
      options.onLeave(false);
      setLocalDetachOpen(false);
    } catch (cause) {
      setOperationError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return {
    project,
    chats: options.chats,
    pinnedBaseCount: options.pinnedBaseCount,
    archiveOpen,
    localDetachOpen,
    localDetachReasons,
    operationError,
    busy,
    requestArchive() {
      setOperationError("");
      setArchiveOpen(true);
    },
    requestLocalDetach() {
      setOperationError("");
      setLocalDetachReasons(
        localDetachArchiveReasons({
          hasProjectBase: options.hasProjectBase,
          groupMemory: options.groupMemory,
        })
      );
      setLocalDetachOpen(true);
    },
    setArchiveOpen,
    setLocalDetachOpen,
    setOperationError,
    archive,
    detachLocal,
  };
}

export type ProjectLifecycleController = ReturnType<typeof useProjectLifecycle>;

export function ProjectLifecycleDialogs({
  controller,
}: {
  controller: ProjectLifecycleController;
}) {
  const { t } = useAppTranslation();
  const {
    project,
    chats,
    pinnedBaseCount,
    archiveOpen,
    localDetachOpen,
    localDetachReasons,
    operationError,
    busy,
  } = controller;
  return (
    <>
      <Dialog open={archiveOpen} onOpenChange={controller.setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("projects.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("projects.archiveDescription", {
                name: project.name,
                chats: chats.length,
              })}
              {pinnedBaseCount > 0 &&
                ` ${t("projects.archivePinned", { bases: pinnedBaseCount })}`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => controller.setArchiveOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void controller.archive()}>
              {t("projects.archive")}
            </Button>
          </DialogFooter>
          {operationError && <p className="mt-3 text-destructive text-sm" role="alert">{operationError}</p>}
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        key={localDetachReasons.length ? "archive-instead" : "remove-local"}
        open={localDetachOpen}
        title={t(
          localDetachReasons.length
            ? "projects.archiveInsteadTitle"
            : "projects.removeLocalTitle",
          { name: project.name }
        )}
        description={
          <>
            {t(
              localDetachReasons.length === 2
                ? "projects.archiveInsteadBoth"
                : localDetachReasons[0] === "project-base"
                  ? "projects.archiveInsteadBase"
                  : localDetachReasons[0] === "group-memory"
                    ? "projects.archiveInsteadMemory"
                    : "projects.removeLocalDescription"
            )}
            {operationError && <span className="mt-3 block text-destructive" role="alert">{operationError}</span>}
          </>
        }
        confirmLabel={t(
          localDetachReasons.length
            ? "projects.archiveInsteadConfirm"
            : "projects.removeLocal"
        )}
        confirmTone="destructive"
        busy={busy}
        showCloseButton
        contentClassName="sm:max-w-[26.25rem] [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:text-muted-foreground [&_[data-slot=dialog-description]]:mt-1 [&_[data-slot=dialog-footer]>button:last-child]:px-4"
        onOpenChange={(next) => {
          controller.setLocalDetachOpen(next);
          if (!next) controller.setOperationError("");
        }}
        onConfirm={() => void controller.detachLocal()}
      />
    </>
  );
}
