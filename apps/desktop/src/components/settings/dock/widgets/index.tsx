/**
 * [INPUT]: Depends on the Dock management bridge, normal Chat routes, existing Settings primitives and localized Widget copy.
 * [OUTPUT]: Provides common Settings/Dock Add/New destinations, definition/instance search, original Chat editing, versions and local instance actions.
 * [POS]: Dock settings management; its source operations never send an Agent message.
 */
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router';
import {normalizedWidgetText} from '@bottega/contracts/plugins/dock/settings';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsSection,SettingsButton,SettingsAlert} from '@/components/settings/settings-layout';
import {useDockWidgets,widgetAuthoringRoute} from '@/lib/platform/dock-widgets/client';
import {subscribeWidgetEntry,consumeWidgetEntry} from '@/lib/platform/dock-widgets/entry';
import {WidgetAccountDefinitions} from './install/definitions';
import type {WidgetAccountDefinition} from '../../../../../shared/system-dock/widgets/install/types';
import type {WidgetRetirementReview} from '../../../../../shared/system-dock/widgets/install/lifecycle';
import {WidgetDeliveryStatus} from './install/delivery';
import type {WidgetUninstallReview} from '../../../../../shared/system-dock/widgets/install/lifecycle';
import type {WidgetInstallReview} from '../../../../../shared/system-dock/widgets/install/types';
import {WidgetPicker,OFFICIAL_WIDGETS} from './picker';
import {WidgetInstanceFormDialog} from './instance-form';
import type {WidgetInstanceForm,WidgetInstanceReceipt} from '../../../../../shared/system-dock/widgets/management';
import type {WidgetManagementSnapshot} from '../../../../../shared/system-dock/widgets/authoring';
import type {OfficialWidgetForm} from '../../../../../shared/system-dock/widgets/official';
const WidgetUninstallDialog=lazy(()=>import('./install/uninstall').then(module=>({default:module.WidgetUninstallDialog})));
const WidgetInstallDialog=lazy(()=>import('./install/dialog').then(module=>({default:module.WidgetInstallDialog})));
const WidgetVersionsDialog=lazy(()=>import('./versions').then(module=>({default:module.WidgetVersionsDialog})));
const OfficialWidgetDialog=lazy(()=>import('./official').then(module=>({default:module.OfficialWidgetDialog})));
export function DockWidgetsSection(){
  const {t}=useAppTranslation(),navigate=useNavigate(),state=useDockWidgets();
  const {snapshot,refresh}=state;
  const [picker,setPicker]=useState(false),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const [retirementReview,setRetirementReview]=useState<WidgetRetirementReview|null>(null),[pendingAdd,setPendingAdd]=useState<WidgetAccountDefinition|null>(null);
  const [uninstallReview,setUninstallReview]=useState<WidgetUninstallReview|null>(null);
  const [installReview,setInstallReview]=useState<WidgetInstallReview|null>(null);
  const [versionId,setVersionId]=useState<string|null>(null);
  const [officialForm,setOfficialForm]=useState<OfficialWidgetForm|null>(null);
  const [initialChoice,setInitialChoice]=useState<string|undefined>();
  const [form,setForm]=useState<WidgetInstanceForm|null>(null),[instanceResult,setInstanceResult]=useState<'pending'|'conflict'|null>(null),returnTarget=useRef<HTMLButtonElement|null>(null),returnItem=useRef<string|null>(null),requests=useRef(new Map<string,{operationId:string;expectedRevision:number;paused:boolean;expectedLayoutRevision:number}>());
  const restoreFocus=()=>requestAnimationFrame(()=>{if(returnTarget.current?.isConnected){returnTarget.current.focus();return;}const id=returnItem.current;const target=id?document.querySelector<HTMLButtonElement>(`[data-widget-instance="${CSS.escape(id)}"] [data-widget-configure]`):null;(target??document.querySelector<HTMLButtonElement>('[data-widget-add]'))?.focus();});
  const lock=useRef(false),operation=useRef<string|null>(null);
  const open=useCallback(async(id?:string)=>{
    if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);
    try{
      operation.current??=crypto.randomUUID();
      const target=id?await window.systemDockSettings.editWidget({definitionId:id}):await window.systemDockSettings.newWidget({operationId:operation.current,name:t('systemDock.widgets.untitled')});
      operation.current=null;navigate(widgetAuthoringRoute(target));
    }catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  },[navigate,t]);
  const configure=useCallback(async(id:string,button?:HTMLButtonElement)=>{
    if(snapshot?.instances.find(value=>value.id===id)?.installation==='source-review'){void open(snapshot.instances.find(value=>value.id===id)!.definitionId);return;}
    if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button??null;returnItem.current=id;
    try{const instance=snapshot?.instances.find(value=>value.id===id);if(!instance)throw new Error('Widget unavailable');
      if(instance.installation==='install'||instance.installation==='update'||instance.installation==='preparing'||instance.installation==='repair'){setInstallReview(await window.systemDockSettings.widgetInstallReview({itemId:id}));return;}
      if(instance.definitionId.startsWith('builtin.'))setOfficialForm(await window.systemDockSettings.officialWidgetPreview({itemId:id}));else setForm(await window.systemDockSettings.instancePreview({itemId:id}));
    }catch(error){setFailed(!(error instanceof Error&&error.message.includes('WIDGET_PACKAGE_NOT_READY')));}finally{lock.current=false;setBusy(false);}
  },[snapshot,open]);
  const install=async(itemId:string,button:HTMLButtonElement)=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button;returnItem.current=itemId;
    try{setInstallReview(await window.systemDockSettings.widgetInstallReview({itemId}));}catch(error){setFailed(!(error instanceof Error&&error.message.includes('WIDGET_PACKAGE_NOT_READY')));}finally{lock.current=false;setBusy(false);}};
  const uninstall=async(subject:{definitionId:string;sourceInstallationId:string},button:HTMLButtonElement)=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button;returnItem.current=null;
    try{const value=await window.systemDockSettings.widgetLifecycleControl({kind:'uninstall-review',definitionId:subject.definitionId,sourceInstallationId:subject.sourceInstallationId});if(value.kind==='uninstall-review')setUninstallReview(value.review);}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const accountInstall=async(definition:WidgetAccountDefinition,button?:HTMLButtonElement)=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button??null;returnItem.current=null;setPicker(false);
    try{const value=await window.systemDockSettings.widgetLifecycleControl({kind:'definition-install-review',definitionId:definition.definitionId,sourceInstallationId:definition.sourceInstallationId,reference:definition.reference});if(value.kind==='install-review'){setPendingAdd(definition);setInstallReview(value.review);}}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const sourceEdit=async(subject:{definitionId:string;sourceInstallationId:string})=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);try{const value=await window.systemDockSettings.widgetLifecycleControl({kind:'definition-edit',definitionId:subject.definitionId,sourceInstallationId:subject.sourceInstallationId});if(value.kind==='source-edit')navigate(widgetAuthoringRoute(value.target));}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const deleteDefinition=async(subject:{definitionId:string;sourceInstallationId?:string},button:HTMLButtonElement)=>{if(lock.current||!window.systemDockSettings||!subject.sourceInstallationId)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button;returnItem.current=null;
    try{const value=await window.systemDockSettings.widgetLifecycleControl({kind:'definition-review',definitionId:subject.definitionId,sourceInstallationId:subject.sourceInstallationId});if(value.kind==='definition-review')setRetirementReview(value.review);}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const retryDeletion=async(operationId:string)=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);try{await window.systemDockSettings.widgetLifecycleControl({kind:'definition-retry',operationId});refresh();}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const addInstalled=async()=>{if(!pendingAdd||!window.systemDockSettings)return;const definition=pendingAdd;setPendingAdd(null);setInstallReview(null);try{setForm(await window.systemDockSettings.savedWidgetPreview({definitionId:definition.definitionId,sourceInstallationId:definition.sourceInstallationId}));}catch{setFailed(true);}};
  const customize=useCallback(async(itemId:string)=>{
    if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);
    try{const key='fork:'+itemId;let request=requests.current.get(key);if(!request){request={operationId:crypto.randomUUID(),expectedRevision:0,paused:false,expectedLayoutRevision:0};requests.current.set(key,request);}
      const target=await window.systemDockSettings.forkWidget({operationId:request.operationId,itemId});requests.current.delete(key);navigate(widgetAuthoringRoute(target));
    }catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  },[navigate]);
  const change=useCallback(async(instance:WidgetManagementSnapshot['instances'][number],remove=false)=>{
    if(lock.current||!window.systemDockSettings||!snapshot)return;lock.current=true;setBusy(true);setFailed(false);setInstanceResult(null);
    const key=instance.id+':'+(remove?'remove':instance.paused?'resume':'pause');
    let request=requests.current.get(key);if(!request){request={operationId:crypto.randomUUID(),expectedRevision:instance.mappingRevision??0,paused:!instance.paused,expectedLayoutRevision:snapshot.layoutRevision};requests.current.set(key,request);}
    try{
      const receipt:WidgetInstanceReceipt=remove?await window.systemDockSettings.removeWidgetInstance({operationId:request.operationId,itemId:instance.id,expectedLayoutRevision:request.expectedLayoutRevision})
        :await window.systemDockSettings.setWidgetPaused({operationId:request.operationId,itemId:instance.id,expectedRevision:request.expectedRevision,paused:request.paused});
      if(receipt.status==='applied')requests.current.delete(key);else setInstanceResult(receipt.status);refresh();
    }catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  },[snapshot,refresh]);
  useEffect(()=>subscribeWidgetEntry(entry=>{
    if(!snapshot||lock.current)return;consumeWidgetEntry(entry.id);if(entry.expiresAt<=Date.now())return;
    const request=entry.entry;
    if(request.kind==='new'){void open();return;}
    if(request.kind==='add'){setInitialChoice(request.definitionId);setPicker(true);return;}
    const instance=snapshot.instances.find(value=>value.id===request.itemId);if(!instance){setFailed(true);return;}
    if(request.kind==='configure')void configure(instance.id);
    else if(request.kind==='edit')void open(instance.definitionId);
    else if(request.kind==='fork')void customize(instance.id);
    else if(request.kind==='versions')setVersionId(instance.definitionId);
    else if(request.kind==='remove')void change(instance,true);
    else if(instance.mappingRevision!==undefined)void change(instance);
  }),[snapshot,busy,open,configure,customize,change]);
  const needle=normalizedWidgetText(query),definitions=state.snapshot?.definitions.filter(definition=>normalizedWidgetText(definition.name+' '+definition.description).includes(needle))??[];
  const definitionName=(id:string,sourceInstallationId?:string)=>{const installed=state.snapshot?.installedDefinitions?.find(value=>value.definitionId===id&&value.sourceInstallationId===sourceInstallationId);if(installed)return installed.name;const official=OFFICIAL_WIDGETS.find(([key])=>key===id);return official?t(official[1]):state.snapshot?.definitions.find(definition=>definition.id===id&&(!sourceInstallationId||definition.sourceInstallationId===sourceInstallationId))?.name??t('systemDock.widgets.states.definition-missing');};
  const installedDefinitions=state.snapshot?.installedDefinitions?.filter(value=>normalizedWidgetText(value.name).includes(needle))??[];
  const accountDefinitions=state.snapshot?.accountDefinitions?.filter(value=>normalizedWidgetText(value.name+' '+value.description).includes(needle)&&!state.snapshot?.installedDefinitions?.some(other=>other.definitionId===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId)&&!state.snapshot?.definitions.some(other=>other.id===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId))??[];
  const instances=state.snapshot?.instances.filter(instance=>normalizedWidgetText(instance.name+' '+definitionName(instance.definitionId,instance.sourceInstallationId)).includes(needle))??[];
  return <section data-dock-widgets=""><SettingsSection title={t('systemDock.widgets.title')}>
    <div className="flex flex-wrap gap-2">
      <SettingsButton data-widget-add="" variant="outline" disabled={busy||!state.snapshot} onClick={()=>{setInitialChoice(undefined);setPicker(true);}}>{t('systemDock.widgets.add')}</SettingsButton>
      <SettingsButton disabled={busy||!state.snapshot} onClick={()=>void open()}>{busy?t('systemDock.widgets.creating'):t('systemDock.widgets.new')}</SettingsButton>
    </div>
    {(failed||state.failed)&&<SettingsAlert><span role="alert">{t('systemDock.widgets.failed')}</span><SettingsButton variant="ghost" onClick={state.refresh}>{t('common.retry')}</SettingsButton></SettingsAlert>}
    {instanceResult&&<SettingsAlert><span role="alert">{t(instanceResult==='conflict'?'systemDock.widgets.conflict':'systemDock.widgets.instancePending')}</span></SettingsAlert>}
    <input type="search" aria-label={t('systemDock.widgets.search')} placeholder={t('systemDock.widgets.search')} value={query} onChange={event=>setQuery(event.target.value)} className="min-h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    {(definitions.length>0||(!installedDefinitions.length&&!accountDefinitions.length)||Boolean(query))&&<div className="divide-y rounded-lg border">{definitions.length?definitions.map(definition=><div key={definition.id} data-widget-definition={definition.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{definition.name}</p><p className="text-xs text-muted-foreground">{t('systemDock.widgets.impact',{count:definition.instanceCount})}</p><WidgetDeliveryStatus deliveries={snapshot?.deliveries?.filter(value=>value.definitionId===definition.id)??[]} onChanged={refresh}/></div>
      <div className="flex flex-wrap gap-2"><SettingsButton variant="outline" disabled={busy} onClick={event=>{returnTarget.current=event.currentTarget;setVersionId(definition.id);}}>{t('systemDock.widgets.versions')}</SettingsButton>
        <SettingsButton data-widget-edit="" variant="outline" disabled={busy} onClick={()=>void open(definition.id)}>{t('systemDock.widgets.edit')}</SettingsButton><SettingsButton variant="outline" disabled={busy||!definition.sourceInstallationId} onClick={event=>void deleteDefinition({definitionId:definition.id,sourceInstallationId:definition.sourceInstallationId},event.currentTarget)}>{t('systemDock.widgets.definitionDelete.confirm')}</SettingsButton></div>
    </div>):<p className="px-4 py-5 text-sm text-muted-foreground">{t(query?'systemDock.widgets.noMatches':installedDefinitions.length?'systemDock.widgets.install.installed':'systemDock.widgets.empty')}</p>}</div>}
    <WidgetAccountDefinitions installed={installedDefinitions} available={accountDefinitions} busy={busy} onAdd={key=>{setInitialChoice(key);setPicker(true);}} onInstall={(value,button)=>void accountInstall(value,button)} onEdit={value=>void sourceEdit(value)} onUninstall={(value,button)=>void uninstall(value,button)} onDelete={(value,button)=>void deleteDefinition(value,button)}/>
    {snapshot?.retirements?.map(value=><SettingsAlert key={value.operationId}><p>{value.name}: {t('systemDock.widgets.definitionDelete.pending')}</p><SettingsButton disabled={busy} variant="outline" onClick={()=>void retryDeletion(value.operationId)}>{t('common.retry')}</SettingsButton></SettingsAlert>)}
    {instances.length>0&&<div className="divide-y rounded-lg border">{instances.map(instance=><div key={instance.id} data-widget-instance={instance.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{instance.name}</p><p className="text-xs text-muted-foreground">{definitionName(instance.definitionId,instance.sourceInstallationId)}{instance.paused?' · '+t('systemDock.widgets.states.paused'):''}{instance.installation==='preparing'?' · '+t('systemDock.widgets.install.preparing'):''}{instance.mappingRevision!==undefined&&(instance.installation==='update'||instance.installation==='needs-setup'||instance.installation==='preparing')?' · '+t('systemDock.widgets.install.oldKept'):''}</p></div>
      <div className="flex flex-wrap gap-2">{instance.installation==='source-review'&&<SettingsButton disabled={busy} onClick={()=>void open(instance.definitionId)}>{t('systemDock.widgets.install.reviewSource')}</SettingsButton>}{(instance.installation==='install'||instance.installation==='update'||instance.installation==='preparing'||instance.installation==='repair')&&<SettingsButton data-widget-install="" disabled={busy} onClick={event=>void install(instance.id,event.currentTarget)}>{t(instance.installation==='repair'?'systemDock.widgets.install.repair':instance.installation==='preparing'?'common.retry':instance.installation==='update'?'systemDock.widgets.install.reviewUpdate':'systemDock.widgets.install.confirm')}</SettingsButton>}<SettingsButton data-widget-configure="" variant="outline" disabled={busy||instance.installation==='source-review'||instance.installation==='install'||instance.installation==='update'||instance.installation==='preparing'||instance.installation==='repair'} onClick={event=>void configure(instance.id,event.currentTarget)}>{t('systemDock.widgets.configure')}</SettingsButton>
        <SettingsButton variant="outline" disabled={busy} onClick={()=>void customize(instance.id)}>{t(instance.definitionId.startsWith('builtin.')?'systemDock.widgets.customize':'systemDock.widgets.copyCustomize')}</SettingsButton>
        <SettingsButton variant="outline" disabled={busy||instance.mappingRevision===undefined} onClick={()=>void change(instance)}>{t(instance.paused?'systemDock.widgets.resume':'systemDock.widgets.pause')}</SettingsButton>
        <SettingsButton variant="outline" disabled={busy} onClick={()=>void change(instance,true)}>{t('systemDock.widgets.remove')}</SettingsButton></div>
    </div>)}</div>}
    {retirementReview&&<Suspense fallback={null}><WidgetUninstallDialog mode="definition" review={retirementReview} onClose={()=>setRetirementReview(null)} onChanged={refresh} onReturnFocus={restoreFocus}/></Suspense>}
    {uninstallReview&&<Suspense fallback={null}><WidgetUninstallDialog review={uninstallReview} onClose={()=>setUninstallReview(null)} onChanged={refresh} onReturnFocus={restoreFocus}/></Suspense>}
    {installReview&&<Suspense fallback={null}><WidgetInstallDialog review={installReview} onClose={()=>{setInstallReview(null);setPendingAdd(null);}} onInstalled={pendingAdd?()=>void addInstalled():undefined} onChanged={refresh} onConfigure={itemId=>{setInstallReview(null);void configure(itemId);}} onReturnFocus={restoreFocus}/></Suspense>}
    {picker&&state.snapshot&&<WidgetPicker snapshot={state.snapshot} initialChoice={initialChoice} onClose={()=>setPicker(false)} onNew={()=>{setPicker(false);void open();}} onOfficial={value=>{setPicker(false);setOfficialForm(value);}} onPersonal={value=>{setPicker(false);setForm(value);}} onInstall={value=>void accountInstall(value)} />}
    {officialForm&&<Suspense fallback={null}><OfficialWidgetDialog key={officialForm.previewId} form={officialForm} onClose={()=>setOfficialForm(null)} onChanged={state.refresh} onReturnFocus={restoreFocus}/></Suspense>}
    {form&&<WidgetInstanceFormDialog key={form.previewId} form={form} onClose={()=>setForm(null)} onChanged={state.refresh} onReturnFocus={restoreFocus} />}
    {versionId&&<Suspense fallback={null}><WidgetVersionsDialog key={versionId} definitionId={versionId} onClose={()=>setVersionId(null)} onChanged={state.refresh} onReturnFocus={restoreFocus}/></Suspense>}
  </SettingsSection></section>;
}
