/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides projectsEn — Sidebar Projects text: grouping actions, unbound folder binding, pinning another computer's Project into this sidebar, reviewed Project rescue, App Edit hiding, Reveal failures, managed-worktree-aware local removal/conditional archiving, 8 colors, 30 icons and appearance controls — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/projects; color and icon IDs are defined by lib/project-appearance
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/en";


export const projectsEn = {
  provider: {
    loadFailed: "Failed to load Projects: {{message}}",
    addFailed: "Failed to add Project: {{message}}",
    appProjectFailed: "Failed to create App Project: {{message}}",
    renameFailed: "Failed to rename Project: {{message}}",
    appearanceFailed: "Failed to save Project appearance: {{message}}",
    revealFailed: "Failed to show Project in the system file manager: {{message}}",
    sortFailed: "Failed to save Project sorting: {{message}}",
    coordinatorUnavailable: "The Project import coordinator is unavailable.",
  },
  sortAria: workspaceCopy.project.sortLabel,
  sortLastUpdated: workspaceCopy.project.recent,
  sortManual: workspaceCopy.project.manual,
  add: "Add Project",
  empty: "Click + to add a folder",
  showMore: "Show more",
  moreActions: workspaceCopy.project.more,
  newChatIn: "New task in {{name}}",
  missingRecord: "Project record is missing",
  missingName: "Lost Project",
  missingFolder: "Project folder is missing: {{dir}}",
  editBadge: "Edit",
  baseTag: "Base",
  rename: workspaceCopy.project.rename,
  renameTitle: workspaceCopy.project.renameTitle,
  renameDescription:
    workspaceCopy.project.renameDescription,
  moveChatsToRoot: "Move chats back to root",
  pin: {
    local: "Local Project",
    remote: "Pin a remote Project…",
    title: "Pin a Project from another computer",
    description: "Its Chats stay on that computer. Pinning only places the Project in this computer's sidebar, and unpinning changes nothing there.",
    empty: "No other computer has a Project to pin yet.",
    unpin: "Unpin",
    deleted: "Deleted",
    archived: "Archived",
    deletedOn: "Deleted on {{device}}",
    archivedOn: "Archived on {{device}}",
  },
  rescue: {
    title: "Move Chats out of this Project?",
    description: "This Project record is missing. Confirmed Chats will move to the root as ordinary Chats and start a new Agent session when you continue.",
    retry: "Check rescue",
    pending: "Waiting for cloud confirmation. The original Chat is preserved.",
    conflicted: "The cloud version changed. Keep the original Chat to abandon this rescue.",
    confirmed: "Confirmed. Finishing the local move.",
    keepOriginal: "Keep original Chat",
    failed: "The move is not complete. Check its status and try again.",
    more: "More Chats are waiting. Review this group to see the next one.",
    untitled: "Untitled Chat",
  },
  unbound: {
    badge: "Needs a folder",
    tooltip:
      "This Project has no folder on this computer yet. Choose one to work in it.",
    chooseFolder: "Choose folder…",
    chooseFailed: "Could not set the Project folder: {{message}}",
    turnRefused:
      "This Project has no folder on this computer. Choose one from the Project menu before starting a task.",
  },
  removeLocal: "Remove local project",
  removeLocalTitle: "Remove {{name}}?",
  removeLocalDescription:
    "This only removes the local project from the app. Files on your computer and existing chats won't be deleted.",
  archiveInsteadTitle: "Archive {{name}} instead?",
  archiveInsteadBase:
    "This Project owns a Project Base, so it can't be removed safely. Archive it instead to keep the Project, Base, files, and chats intact.",
  archiveInsteadMemory:
    "Shared group Memory belongs to this Project, so it can't be removed safely. Archive it instead to keep the Project, Memory, files, and chats intact.",
  archiveInsteadManaged:
    "This Project still owns a managed worktree chat, so its workspace can't be detached safely. Archive it instead, or permanently delete the managed chat first.",
  archiveInsteadBoth:
    "This Project owns a Project Base and shared group Memory, so it can't be removed safely. Archive it instead to keep all of its data intact.",
  archiveInsteadConfirm: "Archive project",
  archive: workspaceCopy.project.archive,
  hideAppProject: "Hide from Projects",
  archiveTitle: workspaceCopy.project.archiveTitle,
  archiveDescription:
    "“{{name}}” and its {{chats}} chats will leave the sidebar. Restore or delete them permanently in Settings › Archive; external and App working folders are never deleted.",
  archiveRootBases: "Root Bases archived with it: {{bases}}.",
  appearance: workspaceCopy.project.appearance,
};
