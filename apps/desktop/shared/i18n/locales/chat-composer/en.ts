/**
 * [INPUT]: Shared native/Web branch and Project selector and Plan catalogs; defines the Chat composer structural baseline.
 * [OUTPUT]: Provides chatComposerEn for approval, branch, Project, Plan, user-input, attachment, and queue surfaces
 * [POS]: English Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/en";
import { branchEn } from "@ai-chat/chat-ui/branch-copy/en";
import { projectSelectorEn } from "@ai-chat/chat-ui/project-copy";

export const chatComposerEn = {
  modelFallback: {
    defaultEffort: "Default",
    standardSpeed: "Standard",
  },
  approval: sharedComposer.approval,
  branch: branchEn,
  surface: {
    plan: "Plan",
    authorizeFileFailed: "Couldn't authorize {{file}}",
    branchBusy: "Wait for the branch operation to finish before sending.",
    fileAuthorizationBusy: "Wait for file authorization to finish before sending.",
    previewMarkdown: "Preview Markdown",
    previewWorkspaceFile: "Preview Workspace file",
    queueSubmit: "Add to queue",
  },
  plan: sharedComposer.chat.composer.plan,
  project: projectSelectorEn,
  userInput: sharedComposer.userInput,
  queue: sharedComposer.chat.composer.queue,
};
