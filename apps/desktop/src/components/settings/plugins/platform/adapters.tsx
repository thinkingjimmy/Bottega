/**
 * [INPUT]: Existing App lifecycle and complete native plugin identities/surfaces. Canonical Server App and Web App labels come from the complete plugin copy catalog.
 * [OUTPUT]: Existing App management with delegated details, folder access and enablement; omits Apps already represented by native page contributions.
 * [POS]: App adapters retain the existing execution owner in Plugins; Skills, Extensions and MCP management stay in Integrations.
 */
import { useState } from 'react';
import { useSettingsNavigation } from '@/components/providers/navigation/context';
import { useNavigate } from 'react-router';
import { ConfirmationDialog } from '@ai-chat/ui/components/ui/app-dialog';
import type { AppDisableImpact } from '@ai-chat/cloud-protocol/apps/build-status/enablement';
import type { UnifiedPluginCatalogItem,UnifiedPluginCatalogSummary } from '@bottega/contracts/plugins/platform';
import { useOptionalApps } from '@/components/providers/content/apps-provider';
import { SettingsAlert,SettingsBadge,SettingsButton,SettingsList,SettingsRow,SettingsSection,SettingsSwitch } from '@/components/settings/settings-layout';
import { disableAppImpact,setAppEnabled } from '@/lib/apps/apps-client';
import { isHostedAppPlugin } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
export function PluginAdapters({native,surfaces,locale}:{native:readonly UnifiedPluginCatalogSummary[];surfaces:readonly UnifiedPluginCatalogItem[];locale:string}){
  const copy=pluginPlatformCopy(locale),apps=useOptionalApps(),navigate=useNavigate(),navigation=useSettingsNavigation();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[impact,setImpact]=useState<AppDisableImpact|null>(null);
  const run=async(operation:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');try{await operation();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}};
  const unresolvedApps=native.some(item=>isHostedAppPlugin(item)&&!surfaces.some(surface=>surface.manifest.id===item.manifest.id));
  const records=unresolvedApps?[]:apps?.records.filter(record=>!surfaces.some(item=>item.manifest.contributions.some(contribution=>contribution.kind==='page'&&contribution.hostAppId===record.id)))??[];
  if(!records.length&&!error&&!impact)return null;
  return <div className="space-y-7" data-plugin-adapters="">
    {error&&<SettingsAlert>{error}</SettingsAlert>}
    {records.length>0&&<SettingsSection title={copy.plugins}><SettingsList>{records.map(record=><SettingsRow key={record.id} label={record.displayName} description={record.lastError?.message??record.sourceRepoUrl??undefined} badge={<SettingsBadge>{record.manifest?.kind==='server'?copy.serverApp:record.manifest?.kind==='static'?copy.webApp:copy.basePlugin}</SettingsBadge>} control={<div className="flex items-center gap-2"><SettingsButton variant="ghost" onClick={()=>{navigation?.close?.();void navigate(`/apps/${encodeURIComponent(record.id)}`);}}>{copy.details}</SettingsButton><SettingsButton variant="ghost" disabled={busy} onClick={()=>void run(()=>apps!.revealApp(record.id))}>{copy.folder}</SettingsButton><SettingsSwitch id={`plugin-app-${record.id}`} checked={record.enabled} label={record.enabled?copy.disable:copy.enable} disabled={busy} onToggle={enabled=>void run(async()=>{if(enabled){await setAppEnabled({appId:record.id,enabled:true,expectedRevision:record.enabledRevision});apps!.refresh();}else setImpact(await disableAppImpact(record.id));})}/></div>}/>)}</SettingsList></SettingsSection>}
    <ConfirmationDialog open={!!impact} busy={busy} title={copy.disable} description={impact?.runningChats.map(chat=>chat.title).join(', ')||copy.nativeNote} confirmLabel={copy.disable} onOpenChange={open=>{if(!open&&!busy)setImpact(null);}} onConfirm={()=>void run(async()=>{if(!impact)return;await setAppEnabled({appId:impact.appId,enabled:false,expectedRevision:impact.revision,impactDigest:impact.digest});setImpact(null);apps?.refresh();})}/>
  </div>;
}
