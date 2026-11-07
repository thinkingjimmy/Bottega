/**
 * [INPUT]: Existing App lifecycle, scoped MCP controller, Library-first Skills authority and external package management. Canonical Server App and Web App labels come from the complete plugin copy catalog.
 * [OUTPUT]: Unified plugin management adapters with source labels and real enablement; external formats expose no Chat source-edit action; Skills navigation reuses the canonical Add Skills label.
 * [POS]: P0 adapters retain the existing execution owner while presenting one Plugins entry.
 */
import { lazy,Suspense,useEffect,useState } from 'react';
import { useSettingsNavigation } from '@/components/providers/navigation/context';
import { useNavigate } from 'react-router';
import { ConfirmationDialog } from '@ai-chat/ui/components/ui/app-dialog';
import type { AppDisableImpact } from '@ai-chat/cloud-protocol/apps/build-status/enablement';
import type { UnifiedPluginCatalogItem,UnifiedPluginCatalogSummary } from '@bottega/contracts/plugins/platform';
import type { UnifiedSkillsSnapshot } from '../../../../../shared/ipc/agent/unified-skills-ipc';
import { useOptionalApps } from '@/components/providers/content/apps-provider';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { SettingsAlert,SettingsBadge,SettingsButton,SettingsList,SettingsRow,SettingsSection,SettingsSwitch } from '@/components/settings/settings-layout';
import { McpServersSection,useMcpServersPort } from '@/components/settings/tools/mcp-servers-section';
import { disableAppImpact,setAppEnabled } from '@/lib/apps/apps-client';
import { applyUnifiedSkillPlan,listUnifiedSkills,onUnifiedSkillsChanged,previewUnifiedSkillIntents } from '@/lib/skills/unified-skills-client';
import { hostPackageIdentity,isHostedAppPlugin } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { SKILLS_SETTINGS_PATH } from '@/lib/settings/navigation/settings-navigation';
const ExtensionsContent=lazy(()=>import('@/views/settings/extensions/settings-extensions').then(module=>({default:module.ExtensionsContent})));
const scope={kind:'global'} as const;
export function PluginAdapters({native,surfaces,locale}:{native:readonly UnifiedPluginCatalogSummary[];surfaces:readonly UnifiedPluginCatalogItem[];locale:string}){
  const copy=pluginPlatformCopy(locale),{t}=useAppTranslation(),apps=useOptionalApps(),navigate=useNavigate(),navigation=useSettingsNavigation();
  const {port:mcp}=useMcpServersPort(scope);
  const [skills,setSkills]=useState<UnifiedSkillsSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[impact,setImpact]=useState<AppDisableImpact|null>(null);
  useEffect(()=>{let live=true;if(window.unifiedSkills)void listUnifiedSkills().then(value=>{if(live)setSkills(value);},cause=>{if(live)setError(String(cause));});const stop=onUnifiedSkillsChanged(value=>{if(live)setSkills(value);});return()=>{live=false;stop();};},[]);
  const run=async(operation:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');try{await operation();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}};
  const hostedPackages=native.flatMap(item=>{const id=hostPackageIdentity(item);return id?[id]:[];});
  const unresolvedApps=native.some(item=>isHostedAppPlugin(item)&&!surfaces.some(surface=>surface.manifest.id===item.manifest.id));
  const records=unresolvedApps?[]:apps?.records.filter(record=>!surfaces.some(item=>item.manifest.contributions.some(contribution=>contribution.kind==='page'&&contribution.hostAppId===record.id)))??[];
  return <div className="space-y-7" data-plugin-adapters="">
    {error&&<SettingsAlert>{error}</SettingsAlert>}
    {records.length>0&&<SettingsSection title={copy.plugins}><SettingsList>{records.map(record=><SettingsRow key={record.id} label={record.displayName} description={record.lastError?.message??record.sourceRepoUrl??undefined} badge={<SettingsBadge>{record.manifest?.kind==='server'?copy.serverApp:record.manifest?.kind==='static'?copy.webApp:copy.basePlugin}</SettingsBadge>} control={<div className="flex items-center gap-2"><SettingsButton variant="ghost" onClick={()=>{navigation?.close?.();void navigate(`/apps/${encodeURIComponent(record.id)}`);}}>{copy.details}</SettingsButton><SettingsButton variant="ghost" disabled={busy} onClick={()=>void run(()=>apps!.revealApp(record.id))}>{copy.folder}</SettingsButton><SettingsSwitch id={`plugin-app-${record.id}`} checked={record.enabled} label={record.enabled?copy.disable:copy.enable} disabled={busy} onToggle={enabled=>void run(async()=>{if(enabled){await setAppEnabled({appId:record.id,enabled:true,expectedRevision:record.enabledRevision});apps!.refresh();}else setImpact(await disableAppImpact(record.id));})}/></div>}/>)}</SettingsList></SettingsSection>}
    {window.extensions&&<details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">{copy.external}</summary><div className="pt-4"><Suspense fallback={<p className="text-xs text-muted-foreground">{copy.loading}</p>}><ExtensionsContent excludeInstallIdentities={hostedPackages} excludeAdapterIds={['bottega-host-package-1']}/></Suspense></div></details>}
    {window.mcpServers&&<details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">{copy.external} · MCP</summary><div className="pt-4"><McpServersSection port={{...mcp,kind:'global',hasPolicyOverrides:false}}/></div></details>}
    {skills&&<details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">{copy.external} · Skills <span className="text-muted-foreground">{skills.library.length}</span></summary><div className="space-y-3 pt-4"><SettingsButton variant="outline" onClick={()=>{navigation?.close?.();void navigate(SKILLS_SETTINGS_PATH);}}>{t('settings.skills.importTitle')}</SettingsButton><SettingsList>{skills.library.map(skill=><SettingsRow key={skill.ref} label={skill.displayName} description={skill.description} badge={<SettingsBadge>{skill.source.label}</SettingsBadge>} control={<SettingsSwitch id={`plugin-skill-${skill.ref}`} label={skill.enabled?copy.disable:copy.enable} checked={skill.enabled} disabled={busy||!skill.allowedActions.includes(skill.enabled?'disable':'enable')} onToggle={enabled=>void run(async()=>{const plan=await previewUnifiedSkillIntents([{type:'set-enabled',skillRef:skill.ref,enabled}]);if(plan.consent.length)throw new Error(copy.unavailable);setSkills(await applyUnifiedSkillPlan({planId:plan.planId,planDigest:plan.planDigest,authorityToken:plan.authorityToken}));})}/>}/>)}</SettingsList></div></details>}
    <ConfirmationDialog open={!!impact} busy={busy} title={copy.disable} description={impact?.runningChats.map(chat=>chat.title).join(', ')||copy.nativeNote} confirmLabel={copy.disable} onOpenChange={open=>{if(!open&&!busy)setImpact(null);}} onConfirm={()=>void run(async()=>{if(!impact)return;await setAppEnabled({appId:impact.appId,enabled:false,expectedRevision:impact.revision,impactDigest:impact.digest});setImpact(null);apps?.refresh();})}/>
  </div>;
}
