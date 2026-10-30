/**
 * [INPUT]: Depends on the main Widget add bridge, strict Unicode names, accessible shared Dialog and localized official definitions.
 * [OUTPUT]: Provides WidgetPicker, shared official label keys, main-owned preselection and explicit host confirmation.
 * [POS]: Shared Settings picker; cancellation before submission changes no layout or Chat.
 */
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '@ai-chat/ui/components/ui/dialog';
import {normalizedWidgetText} from '@bottega/contracts/plugins/dock/settings';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsAlert,SettingsButton} from '@/components/settings/settings-layout';
import type {WidgetAccountDefinition} from '../../../../../shared/system-dock/widgets/install/types';
import type {WidgetManagementSnapshot} from '../../../../../shared/system-dock/widgets/authoring';
import type {WidgetInstanceForm} from '../../../../../shared/system-dock/widgets/management';
import type {OfficialWidgetForm} from '../../../../../shared/system-dock/widgets/official';
type Choice={account?:WidgetAccountDefinition;id:string;definitionId:string;sourceInstallationId?:string;name:string;description:string;available:boolean;instanceCount:number};
export const OFFICIAL_WIDGETS=[['builtin.ai-limits','systemDock.entry.limits'],['builtin.ai-activity','systemDock.entry.activity'],['builtin.tasks','systemDock.entry.tasks']]as const;
export function WidgetPicker({snapshot,onClose,onPersonal,onOfficial,onNew,onInstall,initialChoice}:{snapshot:WidgetManagementSnapshot;onClose():void;onPersonal(form:WidgetInstanceForm):void;onOfficial(form:OfficialWidgetForm):void;onNew():void;onInstall(value:WidgetAccountDefinition):void;initialChoice?:string}){
  const {t}=useAppTranslation(),[choice,setChoice]=useState<string>(initialChoice??'builtin.ai-limits'),[query,setQuery]=useState('');
  const official=OFFICIAL_WIDGETS.some(([id])=>id===choice),needle=normalizedWidgetText(query),choices:Choice[]=[...OFFICIAL_WIDGETS.map(([id,key])=>({id,definitionId:id,name:t(key),description:'',available:true,instanceCount:snapshot.instances.filter(value=>value.definitionId===id).length})),...snapshot.definitions.map(definition=>({...definition,definitionId:definition.id,available:definition.activeGenerationId!==null})),...(snapshot.installedDefinitions??[]).map(value=>({id:value.key,definitionId:value.definitionId,sourceInstallationId:value.sourceInstallationId,name:value.name,description:'',available:true,instanceCount:value.instanceCount})),...(snapshot.accountDefinitions??[]).filter(value=>!snapshot.installedDefinitions?.some(other=>other.definitionId===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId)&&!snapshot.definitions.some(other=>other.id===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId)).map(value=>({...value,id:value.key,account:value,available:true,instanceCount:snapshot.instances.filter(item=>item.definitionId===value.definitionId&&item.sourceInstallationId===value.sourceInstallationId).length}))].filter(value=>normalizedWidgetText(value.name+' '+value.description).includes(needle));
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),lock=useRef(false);
  const add=async()=>{
    if(lock.current||!window.systemDockSettings||!choices.some(value=>value.id===choice&&value.available))return;
    lock.current=true;setBusy(true);setFailed(false);
    try{if(official)onOfficial(await window.systemDockSettings.officialWidgetPreview({definitionId:choice as (typeof OFFICIAL_WIDGETS)[number][0]}));else{const selected=choices.find(value=>value.id===choice)!;if(selected.account){onInstall(selected.account);return;}onPersonal(await window.systemDockSettings.savedWidgetPreview({definitionId:selected.definitionId,...(selected.sourceInstallationId?{sourceInstallationId:selected.sourceInstallationId}:{})}));}}
    catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
    <DialogTitle>{t('systemDock.widgets.addExisting')}</DialogTitle><DialogDescription>{t('systemDock.widgets.add')}</DialogDescription>
    <input type="search" aria-label={t('systemDock.widgets.search')} value={query} onChange={event=>setQuery(event.target.value)} className="min-h-10 rounded-md border bg-transparent px-3" />
    <fieldset disabled={busy} className="max-h-72 space-y-2 overflow-y-auto">{choices.map(value=><label key={value.id} data-widget-choice={value.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2">
      <input type="radio" name="dock-widget-definition" disabled={!value.available} checked={choice===value.id} onChange={()=>setChoice(value.id)} />
      <span className="flex-1 text-sm">{value.name}{!value.available&&<span className="block text-xs text-muted-foreground">{t('systemDock.widgets.noSavedVersion')}</span>}</span><span className="text-xs text-muted-foreground">{t('systemDock.widgets.impact',{count:value.instanceCount})}</span>
    </label>)}</fieldset>
    {!choices.length&&<p role="status">{t('systemDock.widgets.noMatches')}</p>}
    {failed&&<SettingsAlert><span role="alert">{t('systemDock.widgets.addFailed')}</span></SettingsAlert>}
    <DialogFooter><SettingsButton variant="outline" disabled={busy} onClick={onClose}>{t('systemDock.widgets.cancel')}</SettingsButton><SettingsButton variant="outline" disabled={busy} onClick={onNew}>{t('systemDock.widgets.new')}</SettingsButton><SettingsButton disabled={busy||!choices.some(value=>value.id===choice&&value.available)} onClick={()=>void add()}>{t('systemDock.widgets.continue')}</SettingsButton></DialogFooter>
  </DialogContent></Dialog>;
}
