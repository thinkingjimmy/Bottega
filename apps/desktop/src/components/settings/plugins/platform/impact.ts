/**
 * [INPUT]: Bounded catalog pages and exact mode details from the main-owned plugin bridge.
 * [OUTPUT]: readPluginDisableImpact lists enabled transitive dependents and affected modes from one stable catalog revision.
 * [POS]: On-demand enablement review; failed or stale reads cannot produce a complete-looking confirmation.
 */
import type { UnifiedPluginBridge, UnifiedPluginCatalogSummary } from '@bottega/contracts/plugins/platform';

export async function readPluginDisableImpact(bridge: Pick<UnifiedPluginBridge, 'list' | 'get'>, pluginId: string) {
  const items: UnifiedPluginCatalogSummary[] = [], cursors = new Set<string>();
  let cursor: string | undefined, revision: number | undefined;
  do {
    const page = await bridge.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    if (revision !== undefined && revision !== page.revision) throw new Error('Plugin catalog changed. Review the affected plugins again.');
    revision = page.revision; items.push(...page.items); cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('Plugin catalog pagination did not advance. Try again.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (!items.some(item => item.manifest.id === pluginId)) throw new Error('Plugin is no longer installed.');
  const affected = new Set([pluginId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of items) {
      if (!item.installation.enabled || affected.has(item.manifest.id)) continue;
      if (item.manifest.dependencies.some(dependency => affected.has(dependency.pluginId))) {
        affected.add(item.manifest.id); expanded = true;
      }
    }
  }
  const dependents = items.filter(item => item.manifest.id !== pluginId && affected.has(item.manifest.id));
  const modeOwners = items.filter(item => affected.has(item.manifest.id) && item.manifest.contributionKinds.includes('mode'));
  const modes: string[] = [];
  for (const item of modeOwners) {
    const detail = await bridge.get(item.manifest.id);
    if (!detail) throw new Error('An affected plugin changed. Review the affected plugins again.');
    modes.push(...detail.manifest.contributions.flatMap(value => value.kind === 'mode' ? [`${detail.manifest.name} · ${value.name}`] : []));
  }
  if ((await bridge.list({ limit: 1 })).revision !== revision) throw new Error('Plugin catalog changed. Review the affected plugins again.');
  return [...dependents.map(item => item.manifest.name), ...modes];
}
