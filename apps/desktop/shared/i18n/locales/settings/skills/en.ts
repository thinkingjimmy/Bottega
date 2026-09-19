/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides settingsSkillsEn — concise Library-first Settings › Skills, shared global/Project search, import, onboarding-footer, deletion-consent, source, content-presence, cross-device notice, and failure copy — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/skills; the language authority for the pathless Skills experience; no native-target or projection vocabulary remains
 */

export const settingsSkillsEn = {
  tabs: { skills: "Skills", extensions: "Extensions" },
  refresh: "Refresh Skills", importTitle: "Add Skills",
  description: "Import into your personal Library once, then use enabled Skills from every compatible conversation.",
  back: "Back", localFolder: "Local folder", chooseFolder: "Choose a folder…",
  importPrimary: "Import all", importSelected: "Import and enable {{count}}",
  backend: { codex: "Codex", claude: "Claude", kimi: "Kimi", opencode: "OpenCode" },
  sourceKind: { "local-folder": "Local", adopted: "Imported", extension: "Extension" },
  selectSkill: "Select {{name}}", enable: "Enable", disable: "Disable", delete: "Delete", gotoPackage: "View extension",
  batch: { selected: "{{count}} selected", done: "Done" },
  emptyTitle: "No personal Skills yet", emptyScanning: "Looking for Skills in your installed Agents…",
  emptyLead: "Found {{count}} Skills in your existing Agents. Import once to use them from every compatible conversation.",
  emptyNothingHint: "No importable Skills were found. Install an Extension or choose a local folder.",
  readOnly: "Skill management is read-only",
  budget: "{{count}} enabled · session list about {{size}} (estimated from enabled Library Skills)",
  search: "Search Skills", noMatches: "No Skills match this search.",
  confirmDeleteTitle: "Delete Skills?", confirmDeleteBody: "Permanently delete {{count}} Skills from your personal Library.", confirmDeleteAction: "Delete",
  footerImport: "Import your existing Skills →", footerManage: "Manage Skills",
  contentState: { downloading: "Downloading…", missing: "Not on this device" },
  noticeSlugConflict: "Renamed on another device",
  error: { failed: "The Skill operation failed. Try again." },
  reason: {
    "missing-skill-md": "SKILL.md is missing", "invalid-frontmatter": "SKILL.md metadata is invalid", "invalid-name": "The Skill name is invalid",
    "skill-md-too-large": "SKILL.md is too large", "too-many-directories": "Too many nested folders", "too-many-candidates": "Too many candidates",
    symlink: "Symbolic links are not accepted", "unsafe-path": "A path escapes the Skill folder", "not-a-directory": "This is not a folder",
    unreadable: "The folder cannot be read", missing: "The folder is missing", changed: "The folder changed while it was read", timeout: "Discovery timed out",
    "source-gone": "The source is unavailable", "postcondition-changed": "The state changed during the operation", "acquisition-failed": "The import failed",
    "ref-invalid": "The Skill reference is invalid", unknown: "The state cannot be verified",
  },
};
