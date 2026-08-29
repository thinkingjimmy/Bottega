/**
 * [INPUT]: Depends on the composer controller's Skills/Chats/Workspace Files projection, Library-first personal-empty fact, router, optional imported History, current query and Agent icons
 * [OUTPUT]: Provides localized composer suggestion groups, a fixed structured Skills settings action, hidden-count notes, imported History folding, and selection-only results
 * [POS]: Pure composer projection layer; selection carries identity while main revalidates read authority at send time
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import { backendLabel } from "@/lib/agent-backends";
import type {
  RichInputProps,
  RichInputSuggestion,
  RichSuggestionGroup,
} from "@ai-chat/ui/components/ai-elements/rich-input";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { workspaceEntryKind } from "../../../../../shared/workspace-files-ipc";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { workspaceFilesNote } from "../workspace-file-suggestions";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SKILLS_SETTINGS_PATH } from "@/lib/settings-navigation";
import { listUnifiedSkills, onUnifiedSkillsChanged } from "@/lib/unified-skills-client";

export function composerChatsGroup({
  histories,
  loading,
  sections,
  text = { chats: "Chats", loading: "Loading chats…", empty: "No chats available" },
}: {
  histories: number;
  loading: boolean;
  sections: number;
  text?: Readonly<{ chats: string; loading: string; empty: string }>;
}): RichSuggestionGroup {
  return {
    kind: "section",
    kinds: ["section", "history"],
    label: text.chats,
    limit: 70,
    note: loading
      ? text.loading
      : sections + histories === 0
        ? text.empty
        : undefined,
  };
}

export function useComposerSuggestions(
  controller: ChatSessionController["composer"],
  mentionQuery: string | null
) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [personalLibraryEmpty, setPersonalLibraryEmpty] = useState(true);
  useEffect(() => {
    let live = true;
    void listUnifiedSkills()
      .then((snapshot) => live && setPersonalLibraryEmpty(snapshot.personalLibraryEmpty))
      .catch(() => undefined);
    const off = onUnifiedSkillsChanged((snapshot) => {
      if (live) setPersonalLibraryEmpty(snapshot.personalLibraryEmpty);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
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
        description: t("chat.suggestions.sectionDescription", { agent: section.agent }),
        icon: <AgentBackendIcon backend={section.agent} className="size-4" />,
      })),
      ...histories.map((history) => ({
        kind: "history" as const,
        opaqueId: history.opaqueId,
        name: history.title,
        label: history.title,
        agent: history.sourceKind,
        description: t("chat.suggestions.historyDescription", { agent: backendLabel(history.sourceKind) }),
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
      t,
    ]
  );
  const fileNote = workspaceFilesNote(controller.workspaceFiles);
  const suggestionCopy = useMemo<RichInputProps["suggestionCopy"]>(
    () => ({
      skill: {
        groups: [
          {
            kind: "skill" as const,
            label: t("chat.suggestions.skills"),
            limit: 50,
            note: controller.skillsLoading
              ? t("chat.suggestions.loadingSkills")
              : controller.skillsError ||
                (controller.skills.length === 0
                  ? t("chat.suggestions.noSkills")
                  : controller.skillsHiddenCount > 0
                    ? t("chat.suggestions.hiddenSkills", { count: controller.skillsHiddenCount })
                    : undefined),
          },
        ],
        footerAction: {
          label: t(personalLibraryEmpty
            ? "settings.skills.footerImport"
            : "settings.skills.footerManage"),
          onSelect: () => void navigate(SKILLS_SETTINGS_PATH),
        },
      },
      mention: {
        groups: [
          composerChatsGroup({
            histories: histories.length,
            loading: controller.sectionsLoading,
            sections: controller.sections.length,
            text: {
              chats: t("chat.suggestions.chats"),
              loading: t("chat.suggestions.loadingChats"),
              empty: t("chat.suggestions.noChats"),
            },
          }),
          {
            kind: "workspace-file" as const,
            label: t("chat.suggestions.files"),
            note: fileNote,
          },
          {
            kind: "skill" as const,
            label: t("chat.suggestions.skills"),
            limit: 50,
            triggers: ["mention" as const],
            note: controller.skillsLoading
              ? t("chat.suggestions.loadingSkills")
              : controller.skillsError ||
                (controller.skills.length === 0
                  ? t("chat.suggestions.noSkills")
                  : controller.skillsHiddenCount > 0
                    ? t("chat.suggestions.hiddenSkills", { count: controller.skillsHiddenCount })
                    : undefined),
          },
        ],
        ...(controller.workspaceFiles.kind === "ready" &&
        controller.workspaceFiles.indexTruncated
          ? {
              footer: t("chat.suggestions.filesTruncated"),
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
      controller.skillsHiddenCount,
      controller.workspaceFiles,
      fileNote,
      histories.length,
      navigate,
      personalLibraryEmpty,
      t,
    ]
  );

  return { suggestionCopy, suggestions };
}
