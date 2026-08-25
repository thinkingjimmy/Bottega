/**
 * [INPUT]: Depends on two-way owner router, Chats/Projects Provider, draft-route off-site judgment, PageShell, BaseWorkbench/SessionHost and BaseHeaderActions
 * [OUTPUT]: Provides BaseDetailView; Defend chat/Project deep chain, Project Select Recent members to host meetings, zero members directly lay out the Workbench
 * [POS]: The database is a collection of data from the databaseowner/Project Defenders: Bases and the option of meeting status are returned to their hosts
 */

import { DatabaseIcon } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Navigate, useParams } from "react-router";
import {
  BaseHeaderActions,
  ownerRoute,
} from "@/components/bases/chrome/base-header-actions";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import { BaseDetailSessionHost } from "@/components/chat/dock/base-detail-session-host";
import { PageShell } from "@/components/page-shell";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useBases } from "@/components/providers/bases-provider";
import { chatExitRoute, projectAlive } from "@/lib/draft-route";

export function BaseDetailView() {
  const { t } = useAppTranslation();
  const { ownerKind, ownerId } = useParams();
  const { chats, loading } = useChats();
  const { projects, loading: projectsLoading } = useProjects();
  const { movedOwners } = useBases();
  if (
    !ownerId ||
    (ownerKind !== "chat" && ownerKind !== "project")
  ) {
    return <Navigate replace to="/" />;
  }
  if (loading || projectsLoading) {
    return (
      <PageShell title={t("bases.pageTitle")}>
        <div className="h-full animate-pulse bg-muted/20" />
      </PageShell>
    );
  }
  const ownerKey = `${ownerKind}:${ownerId}`;
  const movedTo = movedOwners[ownerKey];
  if (movedTo) return <Navigate replace to={ownerRoute(movedTo)} />;
  const directChat =
    ownerKind === "chat"
      ? chats.find((candidate) => candidate.id === ownerId)
      : undefined;
  const project =
    ownerKind === "project"
      ? projects.find((candidate) => candidate.id === ownerId)
      : directChat?.projectId
        ? projects.find((candidate) => candidate.id === directChat.projectId)
        : undefined;
  /* 已删除或已归档都留不住这个 owner。chat owner 的离场判据与目的地与
     ChatRoute 同源：归档的若只是这条 chat，用户落回它所属 Project 的空白
     页；owner 是 Project 且它自己失效，根级才是唯一去处。 */
  const exitRoute =
    ownerKind === "project"
      ? (projectAlive(project) ? null : "/")
      : (directChat ? chatExitRoute(directChat, projects) : "/");
  if (exitRoute) return <Navigate replace to={exitRoute} />;
  const chat =
    directChat ??
    chats
      .filter(
        (candidate) =>
          candidate.projectId === project?.id && !candidate.effectiveArchived
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const title =
    ownerKind === "project"
      ? `${project!.name} Base`
      : `${directChat!.title ?? "Chat"} Base`;
  return (
    <PageShell
      actions={
        <BaseHeaderActions
          chatId={chat?.id}
          ownerKey={ownerKey}
          projectId={directChat?.projectId}
          mode="page"
        />
      }
      icon={<DatabaseIcon />}
      title={title}
    >
      {chat ? (
        <BaseDetailSessionHost
          key={`${ownerKey}:${chat.id}`}
          ownerKey={ownerKey}
          chatId={chat.id}
        />
      ) : (
        /* 无会话时不加解说条：屏幕上本就只有 Base 工作台，
           再写一句「当前仅显示 Base 工作台」是复述用户已经看见的事。 */
        <BaseWorkbench ownerKey={ownerKey} />
      )}
    </PageShell>
  );
}
