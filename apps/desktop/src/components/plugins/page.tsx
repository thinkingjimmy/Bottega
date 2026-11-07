/**
 * [INPUT]: Main router identity, canonical plugin contributions and immutable Surface host.
 * [OUTPUT]: PluginPage route with real readiness, dependency and failure feedback.
 * [POS]: Main-window page Slot; navigation never creates a source Project or Chat.
 */
import { lazy,Suspense,useEffect,useState } from 'react';
import { useParams } from 'react-router';
import type { UnifiedPluginCatalogItem } from '@bottega/contracts/plugins/platform';
import { PageShell } from '@/components/page-shell';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { SettingsButton } from '@/components/settings/settings-layout';
import { pluginPlatformBridge } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { requestSettingsSection } from '@/lib/settings/navigation/settings-navigation';
import { NativePluginPage } from './host';
import { IsolatedPluginSurface } from './surface';
const HostedAppPage=lazy(()=>import("@/views/apps/app-detail").then(module=>({default:module.AppDetailView})));
export function PluginPage(){
  const {pluginId='',contributionId=''}=useParams(),{i18n}=useAppTranslation(),copy=pluginPlatformCopy(i18n.language),[plugin,setPlugin]=useState<UnifiedPluginCatalogItem|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true,generation=0;const bridge=pluginPlatformBridge();if(!bridge)return;const load=()=>{const request=++generation;void bridge.get(pluginId).then(item=>{if(live&&request===generation){setPlugin(item);setError(item?'':copy.unavailable);}},cause=>{if(live&&request===generation)setError(String(cause));});};load();const stop=bridge.onChanged(load);return()=>{live=false;stop();};},[pluginId,copy.unavailable]);
  const failure=error||(!pluginPlatformBridge()?copy.unavailable:"");
  const page=plugin?.manifest.contributions.find(item=>item.id===contributionId&&item.kind==='page');
  if(page?.kind==='page'&&page.hostViewId)return <NativePluginPage view={page.hostViewId} name={page.name}/>;
  if(page?.kind==='page'&&page.hostAppId&&plugin?.installation.enabled)return <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{copy.loading}</p>}><HostedAppPage hostedAppId={page.hostAppId}/></Suspense>;
  return <PageShell title={page?.name??plugin?.manifest.name??copy.plugins} backHref="/" actions={<SettingsButton variant="ghost" onClick={()=>requestSettingsSection({section:'plugins',plugin:pluginId})}>{copy.details}</SettingsButton>}>
    <div className="h-full min-h-0" data-plugin-page={pluginId}>{failure||plugin&&(!page||!plugin.runtimeReady)?<div role="alert" className="p-6 text-sm text-muted-foreground">{failure||plugin?.error||copy.pageUnavailable}</div>:page?<IsolatedPluginSurface pluginId={pluginId} contributionId={contributionId} title={page.name} locale={i18n.language}/>:<p className="p-6 text-sm text-muted-foreground">{copy.loading}</p>}</div>
  </PageShell>;
}
