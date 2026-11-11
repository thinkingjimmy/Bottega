/**
 * [INPUT]: Depends on bounded canonical catalog/detail receipts, plugin and App impact readers, shared Settings/navigation, localized identity/tool presentation, receiver updates and original native Dock controls.
 * [OUTPUT]: Provides equal-height tag-free UnifiedPluginCards and Provider-style UnifiedPluginDetail with distinct marks, introductions, vertical tool disclosures, reviewed enablement and source recovery.
 * [POS]: Unified Plugins page; runtime state is adopted only from main receipts and changed notifications.
 */
import { useEffect,useRef,useState } from 'react';
import type { WorkbenchCopy } from '@ai-chat/ui/lib/workbench-copy';
import type { PluginView } from '@ai-chat/cloud-protocol/contracts/plugins/catalog';
import { PluginCard } from '../card';
import type { Switching } from '../detail/about';
import { useSettingsNavigation } from '@/components/providers/navigation/context';
import { useNavigate } from 'react-router';
import { ArrowUpRight,FolderOpen,History,LoaderCircle,Pencil } from 'lucide-react';
import { ConfirmationDialog } from '@ai-chat/ui/components/ui/app-dialog';
import { ProductFailureNotice } from '@ai-chat/ui/components/feedback/failure-notice';
import type { AppDisableImpact } from '@ai-chat/cloud-protocol/apps/build-status/enablement';
import { disableAppImpact } from '@/lib/apps/apps-client';
import type { UnifiedPluginCatalogItem,UnifiedPluginCatalogSummary,UnifiedPluginRevision } from '@bottega/contracts/plugins/platform';
import { SettingsAlert,SettingsBadge,SettingsButton,SettingsList,SettingsRow,SettingsSection,SettingsSwitch } from '@/components/settings/settings-layout';
import { pluginPlatformBridge,editablePlugin,isHostedAppPlugin,isNativeDockPlugin } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy,pluginStatusLabel,executionStateLabel } from '@/lib/plugin-platform/copy';
import { pluginAuthoringDraft } from '@/lib/plugin-platform/authoring';
import { UnifiedPluginDelivery } from './delivery';
import { requestSettingsSection } from '@/lib/settings/navigation/settings-navigation';
import { readPluginDisableImpact } from './impact';
import { PluginContributions } from './details/contributions';
import { pluginPresentation, UnifiedPluginIcon } from './details/presentation';
import { PluginCardFrame } from './details/card-frame';
type DockCardProps={plugin:PluginView|undefined;switching:Switching;onSetup(plugin:PluginView):void};
type CatalogCopyProps={workbench:WorkbenchCopy};
const nameOf=(plugin:UnifiedPluginCatalogItem|UnifiedPluginCatalogSummary)=>plugin.manifest.name;
const versionOf=(plugin:UnifiedPluginCatalogItem|UnifiedPluginCatalogSummary)=>plugin.manifest.source.format==='host-package'?plugin.manifest.source.externalVersion:isHostedAppPlugin(plugin)?undefined:plugin.manifest.version;
export function UnifiedPluginCards({items,locale,onOpen,workbench,dock}:{items:readonly UnifiedPluginCatalogSummary[];locale:string;onOpen:(id:string)=>void;dock:DockCardProps}&CatalogCopyProps){
  const copy=pluginPlatformCopy(locale);
  return <div data-unified-plugin-catalog="" className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">{items.map(plugin=>{
    if(isNativeDockPlugin(plugin)&&dock.plugin)return <div key={plugin.manifest.id} data-unified-plugin={plugin.manifest.id}><PluginCard plugin={dock.plugin} workbench={workbench} state={dock.switching.state} onOpen={()=>onOpen(plugin.manifest.id)} onToggle={dock.switching.toggle} onSetup={dock.onSetup}/></div>;
    const presentation=pluginPresentation(plugin,workbench,locale);
    return <PluginCardFrame key={plugin.manifest.id} data-unified-plugin={plugin.manifest.id} name={nameOf(plugin)}
      publisher={<>{presentation.publisher}{versionOf(plugin)&&` · ${versionOf(plugin)}`}</>} summary={presentation.summary}
      icon={<UnifiedPluginIcon plugin={plugin}/>} onOpen={()=>onOpen(plugin.manifest.id)}
      footer={<p className={`line-clamp-2 ${plugin.error?'text-destructive':'text-muted-foreground'}`} role={plugin.status==='building'||plugin.status==='preparing'?'status':undefined}>{pluginStatusLabel(plugin.status,locale)}{plugin.availableRevision&&plugin.availableRevision!==plugin.acceptedRevision?` · ${copy.updateAvailable}`:''}</p>}/>
    ;
  })}</div>;
}
export function UnifiedPluginDetail({plugin,items,locale,onOpen,onRemoved,workbench,computerName:_computerName}:{plugin:UnifiedPluginCatalogItem;items:readonly UnifiedPluginCatalogSummary[];locale:string;onOpen:(id:string)=>void;onRemoved:()=>void;computerName?:string}&CatalogCopyProps){
  const copy=pluginPlatformCopy(locale),navigate=useNavigate(),navigation=useSettingsNavigation(),bridge=pluginPlatformBridge(),id=plugin.manifest.id;
  const [hostImpact,setHostImpact]=useState<AppDisableImpact|null>(null),[sourceRecovery,setSourceRecovery]=useState<UnifiedPluginRevision|null>(null);
  const [disableImpact,setDisableImpact]=useState<string[]>([]);
  const hostAppId=plugin.manifest.contributions.find(item=>item.kind==='page'&&item.hostAppId);
  const delegatedAppId=hostAppId&&hostAppId.kind==='page'?hostAppId.hostAppId:undefined;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[versions,setVersions]=useState<UnifiedPluginRevision[]|null>(null),[confirm,setConfirm]=useState<'disable'|'remove'|'purge'|null>(null),lock=useRef(false);
  const current=useRef(true);useEffect(()=>{current.current=true;return()=>{current.current=false;};},[]);
  const run=async(action:()=>Promise<unknown>,closeConfirmation=true)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();if(current.current&&closeConfirmation)setConfirm(null);}catch(cause){if(current.current)setError(cause instanceof Error?cause.message:String(cause));}finally{lock.current=false;if(current.current)setBusy(false);}};
  const review=(action:'disable'|'remove')=>void run(async()=>{
    const [impact,host]=await Promise.all([action==='disable'?readPluginDisableImpact(bridge!,id):Promise.resolve([]),delegatedAppId?disableAppImpact(delegatedAppId):Promise.resolve(null)]);
    if(!current.current)return;setDisableImpact(impact);setHostImpact(host);setConfirm(action);
  },false);
  const edit=()=>void run(async()=>{const route=await pluginAuthoringDraft({pluginId:id,copy:plugin.manifest.source.kind==='official'||!plugin.manifest.source.editable},locale);navigation?.close?.();void navigate(route);});
  const page=plugin.manifest.contributions.filter(item=>item.kind==='page');
  const source=plugin.manifest.source,nativeView=plugin.manifest.contributions.some(item=>'hostViewId'in item&&item.hostViewId);
  const presentation=pluginPresentation(plugin,workbench,locale),about=workbench.plugins;
  const information=[
    [about.aboutPublisher,presentation.publisher],
    [about.aboutVersion,versionOf(plugin)??'—'],
    [about.aboutSource,source.kind==='copy'?source.pluginId??presentation.publisher:source.format==='bottega'?presentation.publisher:source.format==='host-package'?copy.hostPackage:source.format],
    [about.aboutLocation,source.url??plugin.directory.sourceDirectory??plugin.directory.packageDirectory],
    [about.aboutId,id],
    ...(plugin.activeRevision?[[copy.active,plugin.activeRevision]]:[]),
    ...(plugin.acceptedRevision?[[copy.accepted,plugin.acceptedRevision]]:[]),
  ];
  return <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-8" data-plugin-detail={id} data-plugin-view="about" data-unified-plugin-detail="">
    <header className="flex flex-wrap items-start gap-5"><UnifiedPluginIcon plugin={plugin} size="xl"/><div className="flex min-w-0 flex-1 flex-col gap-1.5"><h1 className="text-balance font-heading text-2xl font-semibold tracking-tight wrap-anywhere">{nameOf(plugin)}</h1><p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>{presentation.publisher}</span>{versionOf(plugin)&&<><span aria-hidden>·</span><span>{versionOf(plugin)}</span></>}<span aria-hidden>·</span><span data-unified-plugin-status={plugin.status}>{pluginStatusLabel(plugin.status,locale)}</span></p>{presentation.summary&&<p data-plugin-summary="" className="max-w-prose text-pretty text-sm text-foreground/80">{presentation.summary}</p>}{plugin.instanceCount>0&&<p className="text-xs text-muted-foreground">{plugin.instanceCount} {copy.instances}</p>}</div>
      <div className="flex items-center gap-2.5 pt-1">
      {plugin.manifest.essential?<SettingsBadge>{copy.essential}</SettingsBadge>:<SettingsSwitch id={`unified-plugin-${id}`} label={plugin.installation.enabled?copy.disable:copy.enable} checked={plugin.installation.enabled} disabled={busy||plugin.status==='draining'} onToggle={enabled=>{if(enabled)void run(()=>bridge!.setEnabled({pluginId:id,enabled:true}));else review('disable');}}/>}
      </div>
    </header>
    {error||plugin.error ? <ProductFailureNotice compact copy={{title:copy.failureToastTitle,explanation:copy.failureToastSingle.replace('{{name}}',()=>nameOf(plugin)),resolution:'',diagnostic:error||plugin.error}}
      labels={{technicalDetails:copy.technicalDetails,copyDetails:copy.copyDetails,copiedDetails:copy.copiedDetails}}/> : plugin.directory.missing&&<SettingsAlert>{copy.sourceMissing}</SettingsAlert>}
    {plugin.warnings.length>0&&<ul className="space-y-1 text-xs text-muted-foreground">{plugin.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
    {plugin.availableRevision&&plugin.availableRevision!==plugin.acceptedRevision&&<SettingsAlert tone="warn">{copy.updateAvailable}</SettingsAlert>}
    <div className="flex flex-wrap gap-2">{editablePlugin(plugin)&&<SettingsButton variant="outline" disabled={busy||plugin.directory.missing} onClick={edit}><Pencil className="size-3.5"/>{source.kind!=='official'&&source.editable?copy.edit:copy.copy}</SettingsButton>}
      {!nativeView&&<SettingsButton variant="outline" disabled={busy} onClick={()=>void run(()=>bridge!.openFolder({pluginId:id}))}><FolderOpen className="size-3.5"/>{copy.folder}</SettingsButton>}
      {!delegatedAppId&&!nativeView&&<SettingsButton variant="outline" disabled={busy} onClick={()=>void run(async()=>setVersions(await bridge!.revisions(id)))}><History className="size-3.5"/>{copy.versions}</SettingsButton>}
      {page.map(item=><SettingsButton key={item.id} disabled={busy||(!item.hostViewId&&(!plugin.installation.enabled||(!item.hostAppId&&!plugin.runtimeReady)))} onClick={()=>{navigation?.close?.();void navigate(`/plugins/${encodeURIComponent(id)}/${encodeURIComponent(item.id)}`);}}>{item.name}<ArrowUpRight className="size-3.5"/></SettingsButton>)}
      {plugin.manifest.contributions.some(item=>item.kind==='widget')&&<SettingsButton variant="ghost" onClick={()=>requestSettingsSection({section:'plugins',plugin:'dock',pluginView:'settings'})}>{copy.settings}</SettingsButton>}
      {!plugin.manifest.essential&&(source.kind!=='official'||delegatedAppId)&&<SettingsButton variant="ghost" disabled={busy} onClick={()=>review('remove')}>{copy.uninstall}</SettingsButton>}
      {!delegatedAppId&&!plugin.manifest.essential&&!plugin.installation.enabled&&source.kind!=='official'&&<SettingsButton variant="ghost" disabled={busy} onClick={()=>setConfirm('purge')}>{copy.removeData}</SettingsButton>}
      {busy&&<LoaderCircle aria-label={copy.loading} className="size-4 animate-spin"/>}
    </div>
    <UnifiedPluginDelivery key={id} plugin={plugin} locale={locale}/>
    {presentation.description&&presentation.description!==presentation.summary&&<SettingsSection title={about.about}>{presentation.description.split(/\n\s*\n/).map(paragraph=><p key={paragraph} className="max-w-[65ch] text-pretty text-sm leading-relaxed">{paragraph}</p>)}</SettingsSection>}
    <PluginContributions contributions={plugin.manifest.contributions} locale={locale}/>
    <SettingsSection title={copy.dependencies}><SettingsList>{plugin.manifest.dependencies.map(dependency=>{const resolved=items.find(item=>item.manifest.id===dependency.pluginId);return <SettingsRow key={dependency.pluginId} label={resolved?.manifest.name??dependency.pluginId} description={resolved?pluginStatusLabel(resolved.status,locale):copy.unavailable} control={resolved?<SettingsButton variant="ghost" onClick={()=>onOpen(resolved.manifest.id)}>{copy.details}</SettingsButton>:undefined}/>;})}{!plugin.manifest.dependencies.length&&<p className="p-4 text-xs text-muted-foreground">{copy.noDependencies}</p>}</SettingsList></SettingsSection>
    {versions&&<SettingsSection title={copy.versions} description={plugin.runtimeReady?copy.restoreNote:copy.restoreEnableNote}><SettingsList>{versions.map(revision=><SettingsRow key={revision.revisionId} label={revision.manifest.version} description={revision.incompatibleReason??new Date(revision.createdAt).toLocaleString(locale)} badge={revision.revisionId===plugin.activeRevision?<SettingsBadge>{copy.active}</SettingsBadge>:undefined} control={<div className="flex flex-wrap gap-2">{(revision.revisionId!==plugin.activeRevision||!plugin.runtimeReady)&&revision.valid&&!revision.incompatibleReason&&<SettingsButton data-plugin-restore-runtime={revision.revisionId} variant="outline" disabled={busy} onClick={()=>void run(()=>bridge!.restore({pluginId:id,revisionId:revision.revisionId}))}>{plugin.runtimeReady?copy.restore:copy.restoreEnable}</SettingsButton>}{(plugin.directory.sourceDirectory||plugin.sourceProject)&&<SettingsButton data-plugin-restore-source={revision.revisionId} variant="ghost" disabled={busy} onClick={()=>setSourceRecovery(revision)}>{copy.sourceOnly}</SettingsButton>}</div>}/> )}</SettingsList></SettingsSection>}
    <SettingsSection title={about.sectionInformation}><dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border p-4 @lg:grid-cols-3">{information.map(([label,value])=><div key={label} className={`flex min-w-0 flex-col gap-0.5 ${label===about.aboutLocation?'@lg:col-span-3':''}`}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm wrap-anywhere">{value}</dd></div>)}</dl></SettingsSection>
    <ConfirmationDialog open={!!sourceRecovery} busy={busy} title={copy.sourceOnly} description={<div data-plugin-source-review="" className="space-y-3"><p>{copy.sourceRestoreNote}</p><p className="break-all text-xs">{sourceRecovery?.manifest.version} · {sourceRecovery?.revisionId}</p>{error&&<p role="alert" className="text-destructive">{error}</p>}</div>} confirmLabel={copy.sourceOnly} onOpenChange={open=>{if(!open&&!busy)setSourceRecovery(null);}} onConfirm={()=>void run(async()=>{if(!sourceRecovery)return;await bridge!.restore({pluginId:id,revisionId:sourceRecovery.revisionId,sourceOnly:true});setSourceRecovery(null);})}/>
    <ConfirmationDialog open={!!confirm} busy={busy} title={confirm==='purge'?copy.removeData:confirm==='remove'?copy.uninstall:copy.disable} description={confirm==='purge'?copy.purgeBody:confirm==='remove'?`${copy.removeBody} ${hostImpact?`${hostImpact.runningCount} ${executionStateLabel('running',locale)} · ${hostImpact.queuedMessages} ${executionStateLabel('queued',locale)}`:''}`:[(hostImpact?`${hostImpact.runningCount} ${executionStateLabel('running',locale)} · ${hostImpact.queuedMessages} ${executionStateLabel('queued',locale)} · ${hostImpact.runningChats.map(chat=>chat.title).join(', ')}`:''),...disableImpact].join(', ')||plugin.manifest.name} confirmLabel={confirm==='purge'?copy.removeData:confirm==='remove'?copy.removeConfirm:copy.disable} confirmTone={confirm==='remove'||confirm==='purge'?'destructive':undefined} onOpenChange={open=>{if(!open&&!busy)setConfirm(null);}} onConfirm={()=>void run(async()=>{if(confirm==='remove'||confirm==='purge'){await bridge!.remove({pluginId:id,...(confirm==='purge'?{deleteData:true}:{}),...(hostImpact?{hostImpact:{revision:hostImpact.revision,digest:hostImpact.digest}}:{})});onRemoved();}else await bridge!.setEnabled({pluginId:id,enabled:false,...(hostImpact?{hostImpact:{revision:hostImpact.revision,digest:hostImpact.digest}}:{})});})}/>
  </div>;
}
