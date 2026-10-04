/**
 * [INPUT]: Depends on workbench-copy (the catalog and formatWorkbench) and the plugin contract's LocalizedText.
 * [OUTPUT]: Provides pluginText (a copy key looked up in the workbench catalog and filled, or a package's own words verbatim),
 *           pluginPublisher (who a card and a plugin page name as its maker), appliesAtLabel and blockReasonLabel.
 * [POS]: The one place the plugins page turns contract text into words; built-in plugins travel as keys so all five languages
 *        come from the catalog, never from main.
 */
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { LocalizedText } from "@ai-chat/cloud-protocol/contracts/plugins/text";
import type { SettingAppliesAt } from "@ai-chat/cloud-protocol/contracts/plugins/settings";
import type { PluginView } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { backendLabel } from "@ai-chat/ui/components/identity/agent";

type Tree = { readonly [key: string]: string | Tree };

/** A key resolves against the whole workbench catalog ("plugins.builtin.claude.name"); an unknown key shows its last segment. */
export function pluginText(text: LocalizedText | null | undefined, workbench: WorkbenchCopy): string {
  if (!text) return "";
  if ("text" in text) return text.text;
  let node: string | Tree | undefined = workbench as unknown as Tree;
  for (const part of text.key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  if (typeof node !== "string") return text.key.split(".").at(-1) ?? text.key;
  return text.params ? formatWorkbench(node, text.params) : node;
}

export const appliesAtLabel = (appliesAt: SettingAppliesAt, copy: WorkbenchCopy["plugins"]) => ({
  immediate: copy.appliesImmediate, "next-turn": copy.appliesNextTurn, "session-create": copy.appliesSessionCreate, "process-start": copy.appliesProcessStart,
})[appliesAt];

export const blockReasonLabel = (reason: "missing" | "disabled" | "unsupported" | "cycle", copy: WorkbenchCopy["plugins"]) => ({
  missing: copy.blockedMissing, disabled: copy.blockedDisabled, unsupported: copy.blockedUnsupported, cycle: copy.blockedCycle,
})[reason];

/** Built-in Providers name their maker; other built-ins are Bottega's; packages are Bottega's only when signed; native ones name the Agent that manages them. */
export function pluginPublisher(plugin: Pick<PluginView, "id" | "source" | "kind" | "official" | "managedBy">, workbench: WorkbenchCopy) {
  const copy = workbench.plugins;
  if (plugin.source === "agent-native") return backendLabel(plugin.managedBy ?? "");
  if (plugin.source === "package") return plugin.official ? copy.publisherBottega : copy.unsigned;
  if (plugin.kind === "provider") return pluginText({ key: `plugins.builtin.${plugin.id}.publisher` }, workbench);
  return copy.publisherBottega;
}
