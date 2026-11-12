/**
 * [INPUT]: Depends on the main Widget add bridge, shared actual Dock instance/default previews and native configuration-required states, strict Unicode names, accessible Dialog and localized official definitions.
 * [OUTPUT]: Provides WidgetPicker, shared official label keys, native preview choices with hover Add, main-owned preselection, no search, saved-definition management and explicit host confirmation.
 * [POS]: Shared Settings picker; cancellation before submission changes no layout or Chat.
 */
import {useRef,useState,type ReactNode} from 'react';
import {Plus} from 'lucide-react';
import type {DockBarItem} from '../../../../../shared/system-dock/ipc';
import {Button} from '@ai-chat/ui/components/ui/button';
import type {WidgetCatalogSnapshot} from '../../../../../shared/system-dock/widgets/catalog';
import {WidgetCatalogPreview} from './catalog/preview';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '@ai-chat/ui/components/ui/dialog';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsAlert,SettingsButton} from '@/components/settings/settings-layout';
import type {WidgetAccountDefinition} from '../../../../../shared/system-dock/widgets/install/types';
import type {WidgetManagementSnapshot} from '../../../../../shared/system-dock/widgets/authoring';
import type {WidgetInstanceForm} from '../../../../../shared/system-dock/widgets/management';
import type {PluginWidgetForm} from '../../../../../shared/system-dock/widgets/plugin';
import type {OfficialWidgetForm} from '../../../../../shared/system-dock/widgets/official';
type Choice={pluginId?:string;contributionId?:string;account?:WidgetAccountDefinition;id:string;definitionId:string;sourceInstallationId?:string;name:string;description:string;available:boolean;instanceCount:number};
const noPreviewDemand=()=>{};
const setupPreview=(choice:Choice):DockBarItem=>({id:`catalog_setup_${choice.id}`,kind:'widget',pinned:false,running:false,status:'ok',iconKey:null,label:choice.name,
  widget:{type:'custom',size:'small',state:'needs-setup',summary:null,description:null,readings:{}}});
export const OFFICIAL_WIDGETS=[['builtin.ai-limits','systemDock.entry.limits'],['builtin.ai-activity','systemDock.entry.activity'],['builtin.tasks','systemDock.entry.tasks']]as const;
export function WidgetPicker({snapshot,onClose,onPersonal,onOfficial,onInstall,onPlugin,initialChoice,management,presentation}:{snapshot:WidgetManagementSnapshot;onClose():void;onPersonal(form:WidgetInstanceForm):void;onOfficial(form:OfficialWidgetForm):void;onInstall(value:WidgetAccountDefinition):void;onPlugin?(form:PluginWidgetForm):void;initialChoice?:string;management?:ReactNode;presentation:{snapshot:WidgetCatalogSnapshot|null;ready:ReadonlySet<string>;observe(id:string,visible:boolean):void;now:number;active:boolean}}){
  const {t}=useAppTranslation(),[choice,setChoice]=useState<string>(initialChoice??'builtin.ai-limits');
  const [seenInitialChoice,setSeenInitialChoice]=useState(initialChoice);
  if(seenInitialChoice!==initialChoice){setSeenInitialChoice(initialChoice);setChoice(initialChoice??'builtin.ai-limits');}
  const choices:Choice[]=[...OFFICIAL_WIDGETS.filter(([id])=>id!=='builtin.ai-activity'||!presentation.snapshot?.officialDirectory||
    presentation.snapshot.defaults.some(value=>value.definitionId===id)).map(([id,key])=>({id,definitionId:id,name:t(key),description:'',available:true,instanceCount:snapshot.instances.filter(value=>value.definitionId===id).length})),...snapshot.definitions.map(definition=>({...definition,definitionId:definition.id,available:definition.activeGenerationId!==null})),...(snapshot.installedDefinitions??[]).map(value=>({id:value.key,definitionId:value.definitionId,sourceInstallationId:value.sourceInstallationId,name:value.name,description:'',available:true,instanceCount:value.instanceCount})),...(snapshot.accountDefinitions??[]).filter(value=>!snapshot.installedDefinitions?.some(other=>other.definitionId===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId)&&!snapshot.definitions.some(other=>other.id===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId)).map(value=>({...value,id:value.key,account:value,available:true,instanceCount:snapshot.instances.filter(item=>item.definitionId===value.definitionId&&item.sourceInstallationId===value.sourceInstallationId).length}))];
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),lock=useRef(false);
  const add=async(selectedId=choice)=>{
    if(lock.current||!window.systemDockSettings||!choices.some(value=>value.id===selectedId&&value.available))return;
    lock.current=true;setBusy(true);setFailed(false);
    try{if(OFFICIAL_WIDGETS.some(([id])=>id===selectedId))onOfficial(await window.systemDockSettings.officialWidgetPreview({definitionId:selectedId as (typeof OFFICIAL_WIDGETS)[number][0]}));else{const selected=choices.find(value=>value.id===selectedId)!;if(selected.pluginId&&selected.contributionId){if(!onPlugin)throw new Error('Plugin Widget form unavailable');onPlugin(await window.systemDockSettings.pluginWidgetForm({pluginId:selected.pluginId,contributionId:selected.contributionId}));return;}if(selected.account){onInstall(selected.account);return;}onPersonal(await window.systemDockSettings.savedWidgetPreview({definitionId:selected.definitionId,...(selected.sourceInstallationId?{sourceInstallationId:selected.sourceInstallationId}:{})}));}}
    catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
    <DialogTitle>{t('systemDock.widgets.addExisting')}</DialogTitle><DialogDescription>{t('systemDock.widgets.add')}</DialogDescription>
    <fieldset disabled={busy} className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">{choices.map(value=>{
      const instance=snapshot.instances.find(item=>item.definitionId===value.definitionId&&(!value.sourceInstallationId||item.sourceInstallationId===value.sourceInstallationId));
      const live=presentation.snapshot?.items.find(item=>item.id===instance?.id)??presentation.snapshot?.defaults.find(item=>item.definitionId===value.definitionId)?.item,item=live??setupPreview(value);
      return <article key={value.id} data-widget-choice={value.id} className="widget-catalog-card"><div className="relative rounded-[20px]" style={{boxShadow:choice===value.id?'0 0 0 2px var(--ring)':'none'}}>
        {presentation.snapshot?<WidgetCatalogPreview item={item} presentation={presentation.snapshot} active={presentation.active} ready={live?presentation.ready.has(item.id):true} observe={live?presentation.observe:noPreviewDemand} now={presentation.now} t={t}/>:<div className="widget-catalog-preview" role="status"><span className="text-xs text-muted-foreground">{t('common.loading')}</span></div>}
        <button type="button" disabled={!value.available||busy} className="absolute inset-0 cursor-pointer rounded-[20px] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2" aria-label={value.name} onClick={()=>setChoice(value.id)}/>
        <div className="widget-catalog-actions"><Button type="button" className="widget-catalog-action" variant="secondary" size="icon" disabled={!value.available||busy} aria-label={`${t('systemDock.widgets.add')}: ${value.name}`} onClick={()=>void add(value.id)}><Plus/></Button></div>
      </div><label className="mt-3 flex min-h-8 cursor-pointer items-start gap-2 px-0.5"><input type="radio" className="mt-0.5" name="dock-widget-definition" disabled={!value.available||busy} checked={choice===value.id} onChange={()=>setChoice(value.id)}/><span className="min-w-0"><span className="block text-sm font-medium">{value.name}</span>{value.description&&<span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{value.description}</span>}{!value.available&&<span className="block text-xs text-muted-foreground">{t('systemDock.widgets.noSavedVersion')}</span>}</span></label></article>;
    })}</fieldset>
    {!choices.length&&<p role="status">{t('systemDock.widgets.noMatches')}</p>}
    {management&&<details className="space-y-3"><summary className="cursor-pointer text-xs text-muted-foreground">{t('systemDock.widgets.catalog.manage')}</summary><div className="max-h-60 space-y-3 overflow-y-auto">{management}</div></details>}
    {failed&&<SettingsAlert><span role="alert">{t('systemDock.widgets.addFailed')}</span></SettingsAlert>}
    <DialogFooter><SettingsButton variant="outline" disabled={busy} onClick={onClose}>{t('systemDock.widgets.cancel')}</SettingsButton><SettingsButton disabled={busy||!choices.some(value=>value.id===choice&&value.available)} onClick={()=>void add()}>{t('systemDock.widgets.continue')}</SettingsButton></DialogFooter>
  </DialogContent></Dialog>;
}
