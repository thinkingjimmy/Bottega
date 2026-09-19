"use client";

/**
 * [INPUT]: Depends on React state, Project/Chat contracts, ProjectsProvider detach mutation, archive client, optional caller-owned archive-success feedback, shared dialogs, and i18n
 * [OUTPUT]: Provides single-flight Project archive/detach confirmations, with success notification immediately after archive resolution and before leaving or closing
 * [POS]: Shared Project lifecycle controller consumed by Sidebar Project rows and Project Settings General
 */

import { useRef, useState } from "react";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import type { Project, ProjectLocalDetachReason } from "../../../../shared/projects-ipc";
import { useProjects } from "@/components/providers/projects-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { archiveTargets } from "@/lib/archive-client";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";

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
    rootBaseCount: number;
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
  const pending = useRef(false);

  const archive = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setOperationError("");
    try {
      await archiveTargets([{ kind: "project", id: project.id }]);
    } catch (cause) {
      setOperationError(errorMessage(cause));
      pending.current = false;
      setBusy(false);
      return;
    }
    try {
      options.onArchived?.();
      setArchiveOpen(false);
      setLocalDetachOpen(false);
      options.onLeave(true);
    } catch {
      // A completed archive stays successful even if its route has already disappeared.
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const detachLocal = async () => {
    if (pending.current) return;
    if (localDetachReasons.length) {
      await archive();
      return;
    }
    pending.current = true;
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
      pending.current = false;
      setBusy(false);
    }
  };

  return {
    project,
    chats: options.chats,
    rootBaseCount: options.rootBaseCount,
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

/* ── 两个确认框，一把尺子 ──────────────────────────────────────────
 * 它们并排住在同一个危险区里，此前却分属两套规范：归档走的是 384px、
 * 12px 正文、黑 80% 加模糊的旧外壳；移除本机记录走的是新外壳，却又用四条
 * 后代选择器把它改回 420px、描述句 mt-1、药丸内边距 px-4，还额外挂了一个
 * 重新定位过的 ×。一个 register 存在的意义就是没人需要在调用点重新调它。
 *
 * 现在两者同形，唯一的差别是那把该有的尺子：归档可回收（Archive 页能原样
 * 捞回来），主按钮因此中性；移除本机记录之后这台机器上再没有这条记录，红
 * 只发给它。触发处那两颗按钮早就是这么分的，确认框现在与它们一致。
 *
 * 报错也从页脚**下面**挪进描述句末尾——页脚是这张弹窗的最后一行，排在它
 * 之后的字没有任何东西保证读者还会往下看。
 * ────────────────────────────────────────────────────────────────── */
export function ProjectLifecycleDialogs({
  controller,
}: {
  controller: ProjectLifecycleController;
}) {
  const { t } = useAppTranslation();
  const {
    project,
    chats,
    rootBaseCount,
    archiveOpen,
    localDetachOpen,
    localDetachReasons,
    operationError,
    busy,
  } = controller;
  const failure = operationError ? (
    <span className="mt-3 block text-[13px] text-destructive" role="alert">
      {operationError}
    </span>
  ) : null;
  const clearOnClose = (next: boolean) => {
    if (!next) controller.setOperationError("");
  };
  return (
    <>
      <ConfirmationDialog
        open={archiveOpen}
        title={t("projects.archiveTitle")}
        description={
          <>
            {t("projects.archiveDescription", {
              name: project.name,
              chats: chats.length,
            })}
            {rootBaseCount > 0 &&
              ` ${t("projects.archiveRootBases", { bases: rootBaseCount })}`}
            {failure}
          </>
        }
        confirmLabel={t("projects.archive")}
        busy={busy}
        onOpenChange={(next) => {
          controller.setArchiveOpen(next);
          clearOnClose(next);
        }}
        onConfirm={() => void controller.archive()}
      />
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
              localDetachReasons.includes("managed-worktree")
                ? "projects.archiveInsteadManaged"
                : localDetachReasons.length === 2
                ? "projects.archiveInsteadBoth"
                : localDetachReasons[0] === "project-base"
                  ? "projects.archiveInsteadBase"
                  : localDetachReasons[0] === "group-memory"
                    ? "projects.archiveInsteadMemory"
                    : "projects.removeLocalDescription"
            )}
            {failure}
          </>
        }
        confirmLabel={t(
          localDetachReasons.length
            ? "projects.archiveInsteadConfirm"
            : "projects.removeLocal"
        )}
        confirmTone="destructive"
        busy={busy}
        onOpenChange={(next) => {
          controller.setLocalDetachOpen(next);
          clearOnClose(next);
        }}
        onConfirm={() => void controller.detachLocal()}
      />
    </>
  );
}
