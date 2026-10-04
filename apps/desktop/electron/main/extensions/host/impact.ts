/**
 * [INPUT]: Depends on the disable-impact contract, the plugin catalog's providersOf and dependentsOf (read only), each plugin's declared effects, Agent-configuration views, workflow bindings and runs, and Chat summaries.
 * [OUTPUT]: Provides computeDisableImpact: for one installed plugin (or Workflow itself, which stops every enabled workflow and pauses every unfinished run), the Providers it supplies and what turning it off would touch — configurations that can no longer be chosen, workflows that start no new run, unfinished runs that pause after their current step, Chats that become read-only, plugins that become unusable (the resolver run again with it off) and its own effects — each sampled with an exact total, validated against the contract.
 * [POS]: The desktop implementation of PluginImpactBridge (TASK-10, Q29 / R-27); it reads and never changes anything (I1–I10 in DEV/platform/foundation-0925/host-packages.md §5).
 */
import { PLUGIN_IMPACT_SAMPLE, pluginDisableImpactSchema, type PluginDisableImpact, type PluginEffectKind } from "@ai-chat/cloud-protocol/contracts/plugins/impact";
import type { LocalizedText } from "@ai-chat/cloud-protocol/contracts/plugins/text";
import type { AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import type { WorkflowBinding } from "@ai-chat/cloud-protocol/contracts/workflow/binding";
import type { WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";

/* Type-only on the run model, so the plugin page (composed at startup) does not load the workflow schemas. */
const TERMINAL: readonly WorkflowRun["state"][] = ["succeeded", "failed", "cancelled"];

export type ImpactPorts = {
  /** The Providers a plugin supplies (built-in or installed; empty while an installed package is off), or null when nothing is installed under that id. */
  providersOf(installIdentity: string): Promise<readonly string[] | null>;
  agentConfigs(): readonly AgentConfigView[];
  bindings(): readonly WorkflowBinding[];
  bindingName(binding: WorkflowBinding): string;
  runs(): readonly WorkflowRun[];
  chats(): readonly { id: string; title?: string | null; agent: string }[];
  /** Plugins that become unusable with this one off (appendix C.4), from the one resolver. */
  dependents(installIdentity: string): Promise<ReadonlyArray<{ pluginId: string; name: LocalizedText }>>;
  /** The plugin's own effects (Tunnel, Dock, Memory declare theirs); none by default. */
  effects?(installIdentity: string): Promise<ReadonlyArray<{ kind: PluginEffectKind; count: number; label: LocalizedText }>>;
  now(): number;
};

const sample = <T>(items: readonly T[]) => ({ items: items.slice(0, PLUGIN_IMPACT_SAMPLE), total: items.length });
const clip = (value: string) => value.slice(0, 256) || "—";

export async function computeDisableImpact(installIdentity: string, ports: ImpactPorts): Promise<PluginDisableImpact> {
  const supplied = await ports.providersOf(installIdentity);
  if (!supplied) throw new Error("plugin-not-installed");
  const providerIds = [...supplied];
  const suppliesProvider = (providerId: string | undefined) => providerId !== undefined && providerIds.includes(providerId);
  /* A-04: Workflow itself supplies no Provider; turning it off stops every enabled workflow and pauses every unfinished run. */
  const workflowPlugin = installIdentity === "workflow";
  const configs = ports.agentConfigs().filter(config => !config.deleted && suppliesProvider(config.payload?.provider));
  const configIds = new Set(configs.map(config => config.configId));
  const workflows = ports.bindings().filter(binding => workflowPlugin ? binding.state === "enabled" : Object.values(binding.roles).some(role => configIds.has(role.configId)));
  const workflowIds = new Set(workflows.map(binding => binding.bindingId));
  const terminal = new Set<string>(TERMINAL);
  const runs = ports.runs().filter(run => {
    if (terminal.has(run.state)) return false;
    /* A cancelling run takes no further step either way. */
    if (workflowPlugin) return run.state !== "cancelling";
    if (!workflowIds.has(run.bindingId)) return false;
    /* Only an agent step still ahead or running can be held up by this Provider (I5). */
    return run.recipe.steps.some(step => {
      if (step.kind !== "agent.run") return false;
      const state = run.steps.find(item => item.stepId === step.id)?.state;
      const frozen = run.configs[step.role] as { resolved?: { provider?: string } } | undefined;
      return (state === "pending" || state === "running" || state === "blocked") && suppliesProvider(frozen?.resolved?.provider);
    });
  });
  const currentLabel = (run: WorkflowRun) => {
    const current = run.steps.find(step => step.state === "running" || step.state === "waiting-human" || step.state === "blocked");
    return current ? clip(run.recipe.steps.find(step => step.id === current.stepId)?.label ?? current.stepId) : null;
  };
  const chats = ports.chats().filter(chat => suppliesProvider(chat.agent));
  return pluginDisableImpactSchema.parse({
    installIdentity, providerIds,
    agentConfigs: sample(configs.map(config => ({ configId: config.configId, name: clip(config.payload!.name) }))),
    workflows: sample(workflows.map(binding => ({ bindingId: binding.bindingId, name: clip(ports.bindingName(binding)), projectId: binding.projectId }))),
    runs: sample(runs.map(run => ({ runId: run.runId, bindingId: run.bindingId, stepLabel: currentLabel(run) }))),
    readOnlyChats: sample(chats.map(chat => ({ chatId: chat.id, title: chat.title ? clip(chat.title) : null }))),
    dependents: sample(await ports.dependents(installIdentity)),
    effects: sample((await ports.effects?.(installIdentity)) ?? []),
    computedAt: ports.now(),
  });
}
