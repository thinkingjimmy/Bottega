/**
 * [INPUT]: Project-scoped native operations, locale and shared branch presentation/contracts.
 * [OUTPUT]: ChatBranchSelector over the shared native/Web branch menu.
 * [POS]: Native adapter; ProjectsService retains Git and task admission authority.
 */
import { useMemo } from "react";
import { BranchSelector } from "@ai-chat/chat-ui/branch-selector";
import { branchCopy } from "@ai-chat/chat-ui/branch-copy";
import { projectGitPage, type GitBranchSnapshot, type GitBranchTarget, type ProjectGitPort } from "@ai-chat/cloud-protocol/resources/project-git";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
export function ChatBranchSelector({ projectId, disabled, listBranches, checkoutBranch, createBranch, onBusyChange }: {
  projectId: string; disabled: boolean;
  listBranches(projectId: string): Promise<GitBranchSnapshot | null>;
  checkoutBranch(projectId: string, target: GitBranchTarget): Promise<GitBranchSnapshot>;
  createBranch(projectId: string, name: string): Promise<GitBranchSnapshot>;
  onBusyChange(busy: boolean): void;
}) {
  const { i18n } = useAppTranslation();
  const port = useMemo<ProjectGitPort>(() => ({
    listBranches: async (id, input) => { const snapshot = await listBranches(id); return snapshot ? projectGitPage(snapshot, input, id) : null; },
    checkoutBranch: async (id, target) => projectGitPage(await checkoutBranch(id, target), { query: "", cursor: null }, id),
    createBranch: async (id, name) => projectGitPage(await createBranch(id, name), { query: "", cursor: null }, id),
  }), [listBranches, checkoutBranch, createBranch]);
  return <BranchSelector projectId={projectId} disabled={disabled} port={port} copy={branchCopy(i18n.resolvedLanguage ?? i18n.language)} onBusyChange={onBusyChange} />;
}
