/**
 * [INPUT]: Depends on workflow preflight results, localized workbench copy and configuration field labels.
 * [OUTPUT]: Provides preflightReason for both first enablement and workflow editing.
 * [POS]: One named-reason projection for desktop workflow setup.
 */
import type { WorkflowPreflightRefusal, WorkflowRolePreflight } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { backendLabel } from "@/lib/agent/agent-backends";
import { settingsList } from "@/components/settings/agent-configs/guarantee-copy";
/**
 * Why a role cannot run, from the runtime's preflight: a freeze refusal names the config, an admission refusal the Provider, and
 * a partial apply (T21-c) the settings that did not take effect, by their field labels joined in the interface language.
 */
export function preflightReason(result: WorkflowRolePreflight, values: { step: string; config: string; computer: string }, workbench: WorkbenchCopy, locale: string) {
  if (result.ready) return null;
  const setup = workbench.setup, run = workbench.run;
  const settings = settingsList(result.settings ?? [], workbench, locale);
  const all = { ...values, settings, provider: result.provider ? backendLabel(result.provider) : "" };
  const text: Record<WorkflowPreflightRefusal, string> = {
    "agent-config-deleted": setup.refusalDeleted, "agent-config-not-enabled": setup.refusalNotEnabled,
    "agent-config-provider-mismatch": setup.refusalMismatch, "agent-config-provider-disabled": run.blockedPluginDisabled,
    "agent-config-memory-write-unsupported": setup.refusalMemoryWrite, "agent-config-selection-unsupported": setup.refusalSelection, "agent-config-scope-unsupported": setup.refusalScope,
    "agent-config-skill-unavailable": setup.refusalSkillUnavailable, "agent-config-mcp-unavailable": setup.refusalMcpUnavailable,
    "agent-config-mcp-read-only": setup.refusalMcpReadOnly, "provider-version-too-old": run.blockedVersionTooOld,
    "agent-config-partially-applied": settings ? setup.refusalPartial : setup.refusalPartialGeneric,
    "provider-signed-out": run.blockedSignedOut, "provider-not-installed": run.blockedNotInstalled, "provider-measurements-unavailable": run.blockedMeasurementsUnavailable, "plugin-disabled": run.blockedPluginDisabled,
    "not-measured": run.blockedNotMeasured, "provider-cannot": run.blockedProviderCannot, "config-unavailable": run.blockedConfigUnavailable,
    // Shown beside the config's name (or its step), so it does not repeat "the config chosen for …".
    "guarantee-unavailable": result.guarantee === "network-off" ? setup.refusalNoNetwork : setup.refusalReadOnly,
    // E2-04: sign-in not confirmed says which way, never "signed out".
    "provider-auth-unknown": run.blockedAuthUnknown, "provider-auth-checking": run.blockedAuthChecking,
    "provider-auth-error": run.blockedAuthError, "provider-auth-timeout": run.blockedAuthTimeout,
  };
  return formatWorkbench(text[result.refusal] ?? run.blockedOther, all);
}
