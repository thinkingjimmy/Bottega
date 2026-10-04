/**
 * [INPUT]: Depends on the Agent-configuration view contract, provider identity and workbench-copy.
 * [OUTPUT]: Provides guaranteeFacts — whether a config earns the Read-only badge, and the "needs attention" lines for
 *           guarantees it asks for but this computer cannot enforce or has not verified, and for settings that did not take
 *           effect here (T21-c) — and settingsList, which names ConfigApplySettings by their field labels in the interface language.
 * [POS]: The one reading of effective guarantees for the Agent configs list (and later the workflow step picker):
 *        a badge only for `enforced`, never for what was merely requested.
 */
import type { AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { backendLabel } from "@/lib/agent/agent-backends";

type Guarantee = NonNullable<AgentConfigView["guarantees"]>["workspace"];
type ConfigApplySetting = NonNullable<AgentConfigView["applyIssue"]>["settings"][number];

function reasonText(guarantee: Guarantee, provider: string, copy: WorkbenchCopy["agentConfigs"]) {
  switch (guarantee.reason) {
    case "provider-cannot": return formatWorkbench(copy.reasonProviderCannot, { provider: backendLabel(provider) });
    case "host-cannot": return copy.reasonHostCannot;
    case "host-unavailable": return copy.reasonHostUnavailable;
    default: return copy.reasonNotMeasured;
  }
}

/** Settings named by their field labels, joined the way the interface language joins a list ("Model and Permissions"). */
export function settingsList(settings: readonly ConfigApplySetting[], workbench: WorkbenchCopy, locale: string) {
  const fields = workbench.agentConfigs;
  const labels: Record<ConfigApplySetting, string> = { model: fields.model, permissions: fields.permissions, instructions: fields.instructions,
    skills: fields.skills, tools: fields.toolsAndData };
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(settings.map(setting => labels[setting]));
}

export function guaranteeFacts(view: AgentConfigView, workbench: WorkbenchCopy, locale: string) {
  const copy = workbench.agentConfigs;
  const guarantees = view.guarantees, provider = view.payload?.provider ?? "";
  const needs = (guarantee: Guarantee) => guarantee.state === "unsupported" || guarantee.state === "unverified";
  // A partial apply is its own fact: it shows whether or not the guarantees are known.
  const settings = view.applyIssue ? settingsList(view.applyIssue.settings, workbench, locale) : "";
  return {
    readOnly: guarantees?.workspace.state === "enforced",
    attention: [
      ...(guarantees && needs(guarantees.workspace) ? [`${copy.guaranteeReadOnly}: ${reasonText(guarantees.workspace, provider, copy)}`] : []),
      ...(guarantees && needs(guarantees.network) ? [`${copy.guaranteeNoNetwork}: ${reasonText(guarantees.network, provider, copy)}`] : []),
      ...(view.applyIssue ? [settings ? formatWorkbench(copy.applyPartial, { settings }) : copy.applyPartialGeneric] : []),
    ],
  };
}
