/**
 * [INPUT]: Depends on React, lucide icons, the Chat composer runtime controller, conversation-scoped read-only branch reads, composer context styling, and Chat composer i18n
 * [OUTPUT]: Provides the persisted managed-worktree branch context row with a read-only branch/uncommitted status chip and no mutation control
 * [POS]: Narrow composer context sibling; draft Project selection and managed permission policy stay in ChatComposer, Project branch mutations in ChatBranchSelector
 */

import { useEffect, useState } from "react";
import { GitBranch, LoaderCircle } from "lucide-react";
import type { GitBranchSnapshot } from "../../../../shared/projects-ipc";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ChatSessionController } from "../runtime/use-chat-session";
import { composerContextButtonClass } from "./chat-project-selector";

function ManagedWorktreeBranchChip({
  projectId,
  chatId,
  listBranches,
}: {
  projectId: string;
  chatId: string;
  listBranches: (
    projectId: string,
    conversationId?: string
  ) => Promise<GitBranchSnapshot | null>;
}) {
  const { t } = useAppTranslation();
  const [snapshot, setSnapshot] = useState<GitBranchSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    listBranches(projectId, chatId)
      .then((next) => {
        if (!live) return;
        setSnapshot(next);
        setError("");
      })
      .catch((cause) => {
        if (live) setError(errorMessage(cause, t("chat.composer.branch.loadFailed")));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [chatId, listBranches, projectId, t]);
  const label = snapshot?.head ?? t("chat.composer.branch.fallback");
  return (
    <div
      aria-label={label}
      className={`${composerContextButtonClass} max-w-56 gap-2 px-3`}
      role="status"
      title={error || undefined}
    >
      {loading && !snapshot ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <GitBranch className="size-4" />
      )}
      <span className="truncate">{label}</span>
      {snapshot && snapshot.uncommittedFiles > 0 && (
        <span className="text-muted-foreground text-xs">
          {t("chat.composer.branch.uncommitted", { count: snapshot.uncommittedFiles })}
        </span>
      )}
    </div>
  );
}

export function ChatManagedWorktreeRow({
  controller,
}: {
  controller: ChatSessionController["composer"];
}) {
  if (!controller.persisted || !controller.selectedProjectId || !controller.chatId) return null;
  return (
    <div className="relative z-0 mx-3 -mb-px flex min-w-0 items-center gap-2 rounded-t-2xl bg-muted px-2 py-[calc(1rem/3)]">
      <ManagedWorktreeBranchChip
        chatId={controller.chatId}
        listBranches={controller.listBranches}
        projectId={controller.selectedProjectId}
      />
    </div>
  );
}
