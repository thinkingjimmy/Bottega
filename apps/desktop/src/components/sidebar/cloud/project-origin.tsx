/**
 * [INPUT]: Depends on main-owned Project origin, the viewed-computer scope and shared localized execution copy.
 * [OUTPUT]: Provides the owning-computer badge for a remotely operated Project row, plus the predicate and computer lookup its row shares with it.
 * [POS]: Read-only sidebar label; naming a computer confers nothing, and the Project's local capability stays independent.
 */
import type { Project } from "../../../../shared/projects-ipc";
import { computerOf } from "@ai-chat/cloud-protocol";
import { executionCopy } from "@ai-chat/chat-ui/execution-copy";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SidebarRowTag } from "@ai-chat/ui/components/workspace/row";
import { useCloudSidebar } from "./context";
import type { ComputerScope } from "@/lib/cloud/computers/scope";
/**
 * A row is operated remotely when the Project really was published by another installation and the panel is
 * showing it as that computer's — either because the tab is that computer's, or because the row was pinned into
 * this one. Both halves have to agree, because everything downstream — no folder, no path, an execution gate —
 * is a claim about a computer that is not this one. A Project this computer published can never carry the badge,
 * pinned or not, and a row that somehow disagrees falls back to the local rules, which offer a folder rather
 * than withhold one.
 */
export function isRemoteProjectRow(scope: ComputerScope, project: Pick<Project, "id" | "cloud">) {
  return (!scope.local || scope.pinnedHere(project.id)) && Boolean(project.cloud?.foreignSource);
}
/** The computer such a row belongs to; the viewed one when the installation has already left the account. */
export function remoteRowComputer(scope: ComputerScope, project: Pick<Project, "cloud">) {
  return computerOf(scope.computers, project.cloud?.sourceDeviceId) ?? scope.viewed;
}
export function ProjectOrigin({ project }: { project: Project }) {
  const { scope } = useCloudSidebar(), { i18n } = useAppTranslation();
  if (!isRemoteProjectRow(scope, project)) return null;
  return <SidebarRowTag>{remoteRowComputer(scope, project)?.name ?? executionCopy(i18n.language).computer}</SidebarRowTag>;
}
