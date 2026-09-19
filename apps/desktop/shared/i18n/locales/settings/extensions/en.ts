/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides settingsExtensionsEn — Settings › Extensions copy for install, inventory, convergence, and retained data — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/extensions; preserves product identity terms across locales
 */

export const settingsExtensionsEn = {
  page: {
    bridgeMissing: "Extension management is unavailable in this environment (IPC bridge missing)",
    admissionClosed:
      "An extension is converging to disabled: projection bindings are being revoked, shared artifacts released, sessions with old discovery snapshots restarted, and caches invalidated. New Agent sessions remain paused until convergence completes.",
    installedTitle: "Installed extensions",
    installedDescription:
      "Install extensions from GitHub. Skills become available to every Agent immediately.",
    installGithub: "Install from GitHub",
    emptyTitle: "No extensions installed",
    emptyHint: "Install an extension from GitHub to get started.",
    retainedTitle: "Uninstalled with data retained",
    retainedDescription:
      "Removing package code never deletes install-owned data implicitly. Permanent deletion is a separate action, and reinstalling the same repository cannot recover deleted data.",
    purgeData: "Permanently delete data",
    retainedCustody: "Custody is still active: {{custody}}",
    retainedEpochs: "{{count}} data epochs remain on this computer.",
  },
  install: {
    stage: {
      source: {
        title: "Add extension",
        description:
          "Paste a GitHub repository homepage. The system freezes a commit, admits an Agent Plugins 1.0 package when plugin.json is present, or imports a pure skills/<name>/SKILL.md repository. Confirmation enables its Skills immediately.",
        commit: "Continue",
        pending: "Resolving source…",
      },
      install: { title: "Confirm installation", commit: "Confirm install", pending: "Installing…" },
      update: { title: "Confirm update", commit: "Confirm update", pending: "Updating…" },
    },
    resolveFailed: "Failed to resolve source",
    installFailed: "Installation failed",
    summary: "{{url}} @ {{commit}} ({{files}} files / {{kilobytes}} KB)",
    repository: "Repository URL",
    repositoryHint:
      "Capabilities are shown only after resolving an immutable commit; nothing is written to the registry before confirmation. A repository already installed becomes a new generation of that installation.",
    back: "Back",
    disclosure: {
      format: "Detected format",
      pluginFormat:
        "Agent Plugins 1.0 package (root plugin.json).",
      skillFormat:
        "Pure Skill repository (no plugin.json; only the skills/ subtree).",
      scripts: "Executable scripts",
      none: "None",
      skill: "Skill {{name}}",
      allowedTools: "allowed-tools: {{tools}}",
      undeclared: "Not declared",
      mcp: "MCP {{serverId}} ({{transport}})",
      mcpUnavailable:
        "MCP component delivery is not available yet and will open in separate policy tiers. {{target}}",
      staticHeaders: "; static headers: {{headers}}",
      writeRoot: "Persistent data write root",
      writeRootRequired:
        "Includes a stdio server and needs an install-owned write root. A new generation uses its own data epoch and never writes alongside the old generation.",
      writeRootNone: "Not required",
      capabilityChange: "Capability changes from the previous generation",
      addedRemoved: "Added: {{added}} | removed: {{removed}}",
      noChange: "No changes",
      report: "Parser note",
      postUpdate: "State after update",
      postInstall: "State after install",
      reauthorize:
        "Capabilities expanded: the new generation starts disabled and every component must be enabled again. The immutable old generation continues serving Apps bound to it.",
      retainAuthorization:
        "Capabilities did not expand: current per-component settings are retained. The immutable old generation continues serving Apps bound to it.",
      defaultEnabled: "Skills are enabled with this confirmation.",
      migrateAria: "Migrate {{appId}} to the new generation",
      migrateDescription:
        "Currently bound to {{generation}}. Migration creates a new generation awaiting authorization; without migration, the App continues using the old generation.",
      migrateLabel: "Migrate App {{appId}}",
    },
  },
  package: {
    description:
      "{{admission}} · {{administration}} · catalog {{catalog}} · App grants are independent · commit {{commit}}",
    admission: { valid: "Admitted", misconfigured: "Misconfigured" },
    administration: { active: "Administration active", "disable-pending": "Administrative disable converging", denied: "Administration denied" },
    catalog: { on: "on", off: "off" },
    enabledCount: "{{enabled}}/{{total}} Skills enabled",
    mcpUnavailable: "MCP delivery is not available yet",
    manageSkills: "Manage Skills",
    checkUpdate: "Check for updates",
    disable: "Disable",
    cancelUninstall: "Cancel uninstall",
    uninstall: "Uninstall",
    eligibilityEntry: "{{backend}}: {{status}}",
    componentDescription: "{{kind}} · {{transport}}",
    kind: { skill: "Skill", "mcp-server": "MCP server" },
    generation: "Previous generation {{generation}}",
    generationBlocked: "Still bound precisely by {{count}} owners; retained immutable and addressable.",
    generationFree: "Unreferenced and eligible for a separate uninstall action.",
    done: "Complete",
    pending: "Pending",
    convergenceBlocked: "Convergence blocked",
    foreignCopy: "External copy {{projectionId}}",
    foreignCopyDetail:
      "{{componentInstanceIdentity}} was not written by the product. It can only be marked {{strength}} and must be handled manually; the product will not claim it was revoked.",
    uninstallBlocked: "Uninstall blocked",
    otherOwners: "Other owners",
    runtimeReferences: "Runtime references",
    runtimeReferencesDetail:
      "{{leases}} projection leases are outstanding; {{artifacts}} shared artifacts are still referenced and will not be removed.",
    custody: "Process / transport custody",
    migrate: "Migrate to new generation",
    migrateDescription:
      "Still bound precisely to {{generation}}. Migration refreezes with this reference closed: required becomes blocked, optional becomes degraded, and authorization is required again. Otherwise cancel uninstall and keep this disabled package installed.",
    retryUninstall: "Retry uninstall",
    convergenceStep: {
      "projection-binding-revoked": "Revoke product-managed projection bindings",
      "shared-artifacts-released": "Release shared artifacts by refcount",
      "product-sessions-drained": "Restart product sessions with old discovery snapshots",
      "discovery-cache-invalidated": "Invalidate discovery caches",
    },
    uninstallStep: {
      "durable-references-resolved": "Resolve durable references (reservations, App generations, and other owners)",
      "runtime-custody-drained": "Drain plan leases, projection leases, and process custody",
      "package-generations-removed": "Remove every package generation",
      "package-bytes-collected": "Collect unreferenced package bytes, excluding install-owned data",
    },
    strength: {
      "per-tool-enforced": "enforced per tool", "per-turn-enforced": "enforced per turn", "server-inclusion-only": "server inclusion only", "workspace-requested": "workspace requested", "backend-delegated": "delegated to backend", "unsupported-by-policy": "blocked by policy", unknown: "unknown",
    },
    exclusion: {
      "package-disabled": "package disabled", "package-disable-pending": "package disable pending", "package-generation-removal-pending": "generation removal pending", "component-disabled": "component disabled", "backend-capability-mismatch": "backend capability mismatch", "delivery-channel-unsupported": "delivery channel unsupported", "transport-unsupported": "transport unsupported", "projection-unavailable": "projection unavailable", "runtime-health-failed": "runtime health failed", "turn-policy-ineligible": "turn policy ineligible", "snapshot-materialization-failed": "snapshot materialization failed",
    },
  },
};
