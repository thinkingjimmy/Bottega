/**
 * [INPUT]: Complete all-pages ready composer contributions and a lazily loaded immutable Surface host.
 * [OUTPUT]: PluginComposerSlot inside the fixed input-extension position, independent of mode-only packages.
 * [POS]: Composer sibling surface; never injects nodes into RichInput or host DOM.
 */
import { lazy,Suspense } from 'react';
import { useRuntimePlugins } from '@/lib/plugin-platform/projection/runtime';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
const IsolatedPluginSurface=lazy(()=>import('./surface').then(module=>({default:module.IsolatedPluginSurface})));
export function PluginComposerSlot(){
  const {items}=useRuntimePlugins(),{i18n}=useAppTranslation();
  const entries=items.filter(plugin=>plugin.runtimeReady&&plugin.installation.enabled).flatMap(plugin=>plugin.manifest.contributions.filter(item=>item.kind==='composer'&&!item.hostViewId).map(item=>({plugin,item})));
  if(!entries.length)return null;
  return <Suspense fallback={null}><div data-plugin-composer-slot="" className="flex flex-col gap-2">{entries.map(({plugin,item})=><section key={`${plugin.manifest.id}/${item.id}`} aria-label={item.name} className="h-32 min-h-0 overflow-hidden rounded-lg border"><IsolatedPluginSurface pluginId={plugin.manifest.id} contributionId={item.id} title={item.name} locale={i18n.language}/></section>)}</div></Suspense>;
}
