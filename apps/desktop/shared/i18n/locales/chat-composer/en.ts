/**
 * [INPUT]: Shared native/Web Project selector and Plan catalogs; defines the Chat composer structural baseline.
 * [OUTPUT]: Provides chatComposerEn for approval, branch, Project, Plan, user-input, attachment, and queue surfaces
 * [POS]: English Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/en";
import { projectSelectorEn } from "@ai-chat/chat-ui/project-copy";

export const chatComposerEn = {
  modelFallback: {
    defaultEffort: "Default",
    standardSpeed: "Standard",
  },
  approval: sharedComposer.approval,
  branch: {
    uncommitted_one: "{{count}} uncommitted file",
    uncommitted_other: "{{count}} uncommitted files",
    loadFailed: "Couldn't load branches",
    checkoutFailed: "Couldn't switch branches",
    createFailed: "Couldn't create the branch",
    fallback: "Branches",
    search: "Search branches",
    empty: "No branches found",
    detached: "Detached HEAD",
    group: "Branches",
    refreshing: "Refreshing branches…",
    newAction: "Create and check out a new branch…",
    createTitle: "Create and check out branch",
    createDescription: "Create a local branch from the current HEAD and check it out.",
    name: "Branch name",
    placeholder: "new-branch",
    close: "Close",
    creating: "Creating…",
    createAndCheckout: "Create and check out",
  },
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
