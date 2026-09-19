/**
 * [INPUT]: Depends on Project/Chat/history background warnings, cloud retry state, and the lazy notice dialog.
 * [OUTPUT]: Loads one failure popup only when needed, keyed by the current incident set so unchanged warnings stay dismissed.
 * [POS]: Lightweight persistent Sidebar feedback host; operation dialogs own their failures independently.
 */
import { lazy, Suspense } from "react";
import { useChats } from "@/components/providers/chats-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import { useCloudSidebar } from "../cloud/context";

const SidebarNoticeDialog = lazy(() => import("./notice-dialog").then(module => ({ default: module.SidebarNoticeDialog })));

export function SidebarNotices() {
  const chats = useChats();
  const projects = useProjects();
  const history = useOptionalHistory();
  const cloud = useCloudSidebar();
  const snapshot = {
    projectWarnings: [...new Set([projects.warning, history?.warning].filter((warning): warning is string => Boolean(warning)))],
    storageFailures: chats.storageFailures,
    chatWarning: chats.warning,
    cloudError: cloud.error,
  };
  if (!snapshot.projectWarnings.length && !snapshot.storageFailures.length && !snapshot.chatWarning && !snapshot.cloudError) return null;
  return <Suspense fallback={null}>
    <SidebarNoticeDialog key={JSON.stringify(snapshot)} {...snapshot} retryCloud={cloud.retry} />
  </Suspense>;
}
