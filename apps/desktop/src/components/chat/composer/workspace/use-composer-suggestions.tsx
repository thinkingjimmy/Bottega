/**
 * [INPUT]: Depends on the composer controller's Skills/Chats/Workspace Files Projection, current @ query and end brand icons
 * [OUTPUT]: Provides use of ComposerSuggestions, returns RichInput suggestions with no reading capability and group text
 * [POS]: The composer/workspace is a pure projection layer; Search results are for selection only, and true read must be fresh resign when the user clicks on the selection
 */

import { useMemo } from "react";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import { backendLabel } from "@/lib/agent-backends";
import type {
  RichInputProps,
  RichInputSuggestion,
} from "@ai-chat/ui/components/ai-elements/rich-input";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { workspaceEntryKind } from "../../../../../shared/workspace-files-ipc";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { workspaceFilesNote } from "../workspace-file-suggestions";

export function useComposerSuggestions(
  controller: ChatSessionController["composer"],
  mentionQuery: string | null
) {
  /* 外源历史与产品 Chats 同台：滤 archived，标题即检索词 */
  const historyContext = useOptionalHistory();
  const histories = useMemo(
    () => (historyContext?.snapshot.entries ?? []).filter((entry) => !entry.archived),
    [historyContext?.snapshot.entries]
  );
  const suggestions = useMemo<RichInputSuggestion[]>(
    () => [
      ...controller.skills.map((skill) => ({
        kind: "skill" as const,
        ref: skill.ref,
        name: skill.name,
        label: skill.displayName ?? skill.name,
        description: skill.description,
      })),
      ...controller.sections.map((section) => ({
        kind: "section" as const,
        chatId: section.chatId,
        name: section.name,
        label: section.name,
        agent: section.agent,
        description: `由 ${section.agent} 处理的聊天`,
        icon: <AgentBackendIcon backend={section.agent} className="size-4" />,
      })),
      ...histories.map((history) => ({
        kind: "history" as const,
        opaqueId: history.opaqueId,
        name: history.title,
        label: history.title,
        agent: history.sourceKind,
        description: `${backendLabel(history.sourceKind)} 导入会话`,
        icon: <AgentBackendIcon backend={history.sourceKind} className="size-4" />,
      })),
      ...(mentionQuery !== null &&
      !controller.workspaceFiles.loading &&
      controller.workspaceFiles.query === mentionQuery &&
      controller.workspaceFiles.kind === "ready"
        ? controller.workspaceFiles.entries.map((entry) => ({
            kind: "workspace-file" as const,
            path: entry.path,
            label: entry.name,
            description: entry.dir,
            entryKind: workspaceEntryKind(entry.entryKind),
          }))
        : []),
    ],
    [
      controller.sections,
      controller.skills,
      controller.workspaceFiles,
      histories,
      mentionQuery,
    ]
  );
  const fileNote = workspaceFilesNote(controller.workspaceFiles);
  const suggestionCopy = useMemo<RichInputProps["suggestionCopy"]>(
    () => ({
      skill: {
        groups: [
          {
            kind: "skill" as const,
            label: "Skills",
            limit: 50,
            note: controller.skillsLoading
              ? "正在加载 Skills…"
              : controller.skillsError ||
                (controller.skills.length === 0 ? "没有可用 Skill" : undefined),
          },
        ],
      },
      mention: {
        groups: [
          {
            kind: "section" as const,
            label: "Chats",
            limit: 50,
            note: controller.sectionsLoading
              ? "正在加载 Chats…"
              : controller.sections.length === 0
                ? "没有可用 Chat"
                : undefined,
          },
          {
            kind: "history" as const,
            label: "Imported history",
            limit: 20,
            note: histories.length === 0 ? "没有可引用的导入会话" : undefined,
          },
          {
            kind: "workspace-file" as const,
            label: "Files",
            note: fileNote,
          },
          {
            kind: "skill" as const,
            label: "Skills",
            limit: 50,
            triggers: ["mention" as const],
            note: controller.skillsLoading
              ? "正在加载 Skills…"
              : controller.skillsError ||
                (controller.skills.length === 0 ? "没有可用 Skill" : undefined),
          },
        ],
        ...(controller.workspaceFiles.kind === "ready" &&
        controller.workspaceFiles.indexTruncated
          ? {
              footer:
                "仓库文件过多，部分文件未进入索引；请输入更精确的关键词",
            }
          : {}),
      },
    }),
    [
      controller.sections.length,
      controller.sectionsLoading,
      controller.skills.length,
      controller.skillsError,
      controller.skillsLoading,
      controller.workspaceFiles,
      fileNote,
      histories.length,
    ]
  );

  return { suggestionCopy, suggestions };
}
