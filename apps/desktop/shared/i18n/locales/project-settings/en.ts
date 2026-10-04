/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides projectSettingsEn — Project Settings routes, tabs, scope disclosures, exact-Project Tools, instruction/skill/tool states, and grant-gated App Sidebar placement copy — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/project-settings; the feature catalog for Project Settings surfaces
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/en";


export const projectSettingsEn = {
  entry: workspaceCopy.project.settings,
  open: "Open project settings",
  title: workspaceCopy.project.settingsTitle,
  tabs: { general: "General", personalization: "Personalization", skills: "Skills", extensions: "Extensions", tools: "Tools" },
  general: {
    sectionBasics: workspaceCopy.project.basics, name: workspaceCopy.project.identity, renameAction: "Rename", appearanceAria: workspaceCopy.project.appearanceLabel,
    memory: "Memory", memoryDisabled: "Memory service is disabled", memoryPaused: "Memory is paused", memoryUnavailable: "Service unavailable", memoryScoped: "This Project has an independent memory scope", memoryShared: "Memory is shared by chat or personal scope; this Project has no separate scope", memoryDelivering: "Imported memory is being delivered…", memoryManage: "Manage Memory",
    history: "History import", historyHint: "Import compatible external Agent history for this Project.",
    appsSection: "Apps", appsDescription: "Apps added here can be used in this Project's conversations. Pin only puts one in the Sidebar; it never changes what data it can see.", appsManagedByApp: "This App Project manages capabilities from its App page.",
    placements: { pinControl: "Pin {{name}} to the Sidebar", grantSummary: "{{grant}} · {{agent}}", unavailableBadge: "Unavailable", agentOn: "the Agent can act for you", agentOff: "only you can operate it", noGrant: "not authorized yet", unavailable: "This build cannot run yet — fix it on the Apps page before pinning", empty: "No Apps in this Project yet", emptyHint: "Once added, it shows up in this Project's conversations. You decide what data it can see.", loading: "Loading Apps…", failed: "Apps could not be loaded.", retry: "Retry", pending: "Saving Pin…", pinFailed: "Could not save this App's Pin." },
    baseSection: workspaceCopy.project.baseTitle, baseEmpty: workspaceCopy.project.baseEmpty, baseCreate: workspaceCopy.project.baseCreate, baseOpen: workspaceCopy.project.baseOpen, baseSummary: workspaceCopy.project.baseSummary, baseLoading: "Loading Project Base",
    danger: workspaceCopy.project.danger, archiveHint: workspaceCopy.project.archiveHint, detachHint: "Remove the local Project record without deleting its external folder.", appLifecycleHint: "This App Project follows its App lifecycle. Delete the App from the Apps page."
  },
  instructions: {
    section: "Project instructions", description: "Edit the instruction files read by Agents in this Project workspace.", pointerHint: "This file points to AGENTS.md and usually does not need direct editing.", noWorkspace: "Choose a workspace from the Project row menu first.", bridgeMissing: "Project Personalization is unavailable in this environment.", appReadOnly: "App Project instruction files are read-only because the App generation owns their content.", appEditGuide: "Open the App page to continue in an App Edit conversation.", workspaceChanged: "The Project workspace changed. The disk baseline was refreshed; your draft was preserved.", loading: "Loading Project instructions", saveFailed: "Project instruction save failed", outsideWorkspace: "This instruction file resolves outside the Project workspace and cannot be read or changed.", appManaged: "App Project instructions are managed by the App generation."
  },
  skills: {
    section: "Callable Project Skills", scopeNote: "Project Skills follow this workspace; manage the inherited global library in Settings › Skills.", runtimeNote: "This list contains Skills callable through `$` in the product. Agent terminals may use different native discovery rules.", inheritedGroup: "Inherited global Skills ({{count}})", empty: "No callable Project Skills", emptyHint: "Place a skill at {{dir}}/.agents/skills/<name>/SKILL.md, then click Refresh.",   noWorkspace: "No Project workspace selected", noWorkspaceHint: "Choose a workspace to add Project Skills. Global and Extension Skills remain visible below.", loadFailed: "Project Skills could not be loaded.", badge: { repo: "Project", user: "User", system: "System", admin: "Admin", extension: "Extension" }
  },
  extensions: { scopeNote: "Install an Extension into this Project and its Skills become available only to conversations in this Project. Other Projects are unaffected." },
  tools: {
    scopeNote: "Changes here affect only “{{name}}”; unchanged items inherit global defaults.",
    bridgeMissing: "Project tool settings are unavailable in this environment.",
  }
};
