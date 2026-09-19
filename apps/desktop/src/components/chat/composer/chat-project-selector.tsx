/**
 * [INPUT]: Shared Project menu/selector, native Project metadata and composer translation keys.
 * [OUTPUT]: Native ChatProjectMenu, ChatProjectSelector and context-button classes with existing creation callbacks.
 * [POS]: Thin native adapter; local chat, remote chat and empty state consume the same Project presentation as Web.
 */
import type { ReactNode } from "react";
import { ProjectMenu, ProjectSelector, type ProjectMenuProps } from "@ai-chat/chat-ui/project-selector";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export { composerContextButtonClass } from "@ai-chat/chat-ui/project-selector";

type NativeProjectMenuProps = Omit<ProjectMenuProps, "copy" | "status" | "pagination">;
function useProjectCopy() {
  const { t } = useAppTranslation();
  return {
    selector: t("chat.composer.project.selector"),
    search: t("chat.composer.project.search"),
    empty: t("chat.composer.project.empty"),
    create: t("chat.composer.project.create"),
    creating: t("chat.composer.project.creating"),
    workInChat: t("chat.composer.project.workInChat"),
    current: t("chat.composer.project.current", { project: "{{project}}" }),
    chat: t("chat.composer.project.chat"),
  };
}
export function ChatProjectMenu(props: NativeProjectMenuProps & {
  children: ReactNode | ((state: { creating: boolean }) => ReactNode);
}) {
  return <ProjectMenu {...props} copy={useProjectCopy()} />;
}
export function ChatProjectSelector(props: NativeProjectMenuProps) {
  return <ProjectSelector {...props} copy={useProjectCopy()} />;
}
