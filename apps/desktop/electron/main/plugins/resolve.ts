/**
 * [INPUT]: Depends on the plugin contract types (PluginNode, Resolution, ContractKind) from @bottega/contracts/plugins/contracts.
 * [OUTPUT]: Provides resolvePlugins (the one dependency resolver) and dependencyCycles.
 * [POS]: Appendix C.2's single entry: the catalog's list and detail, the disable impact (resolve again with the target off), host-package
 *        negotiation and workflow admission all call it, so the page never says "met" while a runtime says `contract-missing`. Pure.
 */
import type { BlockReason, ContractKind, PluginNode, Resolution } from "@bottega/contracts/plugins/contracts";

type Blocked = Array<{ contract: string; reason: BlockReason }>;

/** Plugins on a dependency cycle (each requires, through non-host contracts, something only reachable back through itself). */
export function dependencyCycles(nodes: readonly PluginNode[], kindOf: (contract: string) => ContractKind): Set<string> {
  const providers = new Map<string, string[]>();
  for (const node of nodes) for (const contract of node.provides) providers.set(contract, [...(providers.get(contract) ?? []), node.id]);
  const edges = new Map(nodes.map(node => [node.id, node.requires.filter(contract => kindOf(contract) !== "host")
    .flatMap(contract => providers.get(contract) ?? [])]));
  /* Tarjan's strongly connected components; a component of two or more, or a node requiring itself, is a cycle. */
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), cyclic = new Set<string>();
  let counter = 0;
  const visit = (id: string) => {
    index.set(id, counter); low.set(id, counter); counter += 1; stack.push(id); onStack.add(id);
    for (const next of edges.get(id) ?? []) {
      if (!index.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)); }
      else if (onStack.has(next)) low.set(id, Math.min(low.get(id)!, index.get(next)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    for (let member = stack.pop()!; ; member = stack.pop()!) { onStack.delete(member); component.push(member); if (member === id) break; }
    if (component.length > 1 || (edges.get(id) ?? []).includes(id)) for (const member of component) cyclic.add(member);
  };
  for (const node of nodes) if (!index.has(node.id)) visit(node.id);
  return cyclic;
}

/**
 * A plugin is usable when its platform supports it, it is on, and every `requires` is met: host contracts always; an exclusive one by
 * its single usable owner; a shared one by any usable provider. Computed as a fixed point, so unusability propagates; cycles are
 * unusable. `blockedBy` is filled for every plugin (on or off), so a plugin switched on shows at once what it would wait for.
 */
export function resolvePlugins(nodes: readonly PluginNode[], kindOf: (contract: string) => ContractKind): Resolution {
  const cyclic = dependencyCycles(nodes, kindOf);
  const byContract = new Map<string, PluginNode[]>();
  for (const node of nodes) for (const contract of new Set(node.provides)) byContract.set(contract, [...(byContract.get(contract) ?? []), node]);
  const conflicts = [...byContract].filter(([contract, holders]) => kindOf(contract) === "exclusive" && holders.length > 1)
    .map(([contract, holders]) => ({ contract, pluginIds: holders.map(holder => holder.id) }));
  const conflicted = new Set(conflicts.map(item => item.contract));

  const usable = new Set(nodes.filter(node => node.enabled && node.platformSupported && !cyclic.has(node.id)).map(node => node.id));
  const unmet = (node: PluginNode): Blocked => node.requires.flatMap(contract => {
    const kind = kindOf(contract);
    if (kind === "host") return [];
    const holders = byContract.get(contract) ?? [];
    const live = holders.filter(holder => usable.has(holder.id) && holder.id !== node.id);
    if (kind === "shared" ? live.length > 0 : live.length === 1 && !conflicted.has(contract)) return [];
    return [{ contract, reason: reasonOf(holders.filter(holder => holder.id !== node.id), cyclic) }];
  });
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes) if (usable.has(node.id) && unmet(node).length) { usable.delete(node.id); changed = true; }
  }
  const plugins: Record<string, { usable: boolean; blockedBy: Blocked }> = {};
  for (const node of nodes) {
    const blockedBy = cyclic.has(node.id) ? node.requires.filter(contract => kindOf(contract) !== "host").map(contract => ({ contract, reason: "cycle" as const })) : unmet(node);
    plugins[node.id] = { usable: usable.has(node.id), blockedBy };
  }
  const owners: Record<string, string[]> = {};
  for (const [contract, holders] of byContract) owners[contract] = holders.filter(holder => usable.has(holder.id)).map(holder => holder.id);
  return { plugins, owners, conflicts };
}

/* Why a contract is not met, in the order a person can act on: nothing provides it; its providers are off; their platform cannot
   run them; they sit on a cycle; they are themselves waiting (missing further down). */
function reasonOf(holders: readonly PluginNode[], cyclic: ReadonlySet<string>): BlockReason {
  if (!holders.length) return "missing";
  if (holders.every(holder => !holder.enabled)) return "disabled";
  const on = holders.filter(holder => holder.enabled);
  if (on.every(holder => !holder.platformSupported)) return "unsupported";
  if (on.every(holder => cyclic.has(holder.id))) return "cycle";
  return "missing";
}
