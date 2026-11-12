/**
 * [INPUT]: Source-action availability from the canonical Widget catalog; Depends on the Dock management bridge, normal Chat routes, existing confirmation primitives, the shared actual Dock renderer, bounded visible preview transport and localized Widget copy/ready-only retarget state.
 * [OUTPUT]: Dock Widget instance grid, toolbar Add/New destinations and configuration forms, package management and local repair, with native shortcut routing.
 * [POS]: Enabled Dock's Widget management tab; its source operations only set a durable authoring intent; first send allocates the source Project.
 */
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router';
import {createPortal} from 'react-dom';
import {isDistributedWidgetId,type DistributedWidgetId} from '../../../../../shared/system-dock/widgets/catalog/distribution';
import {nativeWidgetType,OFFICIAL_WIDGETS,type OfficialWidgetId} from '../../../../../shared/system-dock/widgets/catalog/official';
import {WidgetAddMenu} from './catalog/add-menu';
import {WidgetInstanceCard} from './catalog/card';
import {WidgetCatalogPreview} from './catalog/preview';
import {useWidgetCatalog} from './catalog/client';
import {useNow} from '@/system-dock/common/bridge';
import './catalog/styles.css';
import {PluginWidgetFormDialog} from './plugin/form';
import type {PluginWidgetForm} from '../../../../../shared/system-dock/widgets/plugin';
import {requestSettingsSection} from '@/lib/settings/navigation/settings-navigation';
import {pluginAuthoringDraft,widgetPluginAuthoringDraft} from '@/lib/plugin-platform/authoring';
import {useSettingsNavigation} from '@/components/providers/navigation/context';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {AppCatalogSkeleton} from '@ai-chat/ui/components/catalog/app-catalog';
import {SettingsButton,SettingsAlert} from '@/components/settings/settings-layout';
import {useDockWidgets} from '@/lib/platform/dock-widgets/client';
import {subscribeWidgetEntry,consumeWidgetEntry} from '@/lib/platform/dock-widgets/entry';
import type {WidgetAccountDefinition} from '../../../../../shared/system-dock/widgets/install/types';
import {WidgetAccountDefinitions} from './install/definitions';
import type {WidgetRetirementReview} from '../../../../../shared/system-dock/widgets/install/lifecycle';
import {WidgetDeliveryStatus} from './install/delivery';
import type {WidgetUninstallReview} from '../../../../../shared/system-dock/widgets/install/lifecycle';
import type {WidgetInstallReview} from '../../../../../shared/system-dock/widgets/install/types';
import {WidgetPicker} from './picker';
import {WidgetInstanceFormDialog} from './instance-form';
import type {WidgetInstanceForm,WidgetInstanceReceipt} from '../../../../../shared/system-dock/widgets/management';
import type {WidgetManagementSnapshot} from '../../../../../shared/system-dock/widgets/authoring';
import type {OfficialWidgetForm} from '../../../../../shared/system-dock/widgets/official';
const WidgetDirectoryDialog=lazy(()=>import('./catalog/directory').then(module=>({default:module.WidgetDirectoryDialog})));
const WidgetUninstallDialog=lazy(()=>import('./install/uninstall').then(module=>({default:module.WidgetUninstallDialog})));
const WidgetInstallDialog=lazy(()=>import('./install/dialog').then(module=>({default:module.WidgetInstallDialog})));
const WidgetVersionsDialog=lazy(()=>import('./versions').then(module=>({default:module.WidgetVersionsDialog})));
const OfficialWidgetDialog=lazy(()=>import('./official').then(module=>({default:module.OfficialWidgetDialog})));
export function DockWidgetsSection({active=true,actionsContainer}:{active?:boolean;actionsContainer?:HTMLElement|null}){
  const {t,i18n}=useAppTranslation(),navigate=useNavigate(),state=useDockWidgets(),navigation=useSettingsNavigation();
  const {snapshot,refresh}=state,presentation=useWidgetCatalog(active),now=useNow();
  const [directory,setDirectory]=useState<{pluginId:DistributedWidgetId;itemId:string}|true|null>(null);
  const [picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const [retirementReview,setRetirementReview]=useState<WidgetRetirementReview|null>(null),[pendingAdd,setPendingAdd]=useState<WidgetAccountDefinition|null>(null);
  const [uninstallReview,setUninstallReview]=useState<WidgetUninstallReview|null>(null);
  const [installReview,setInstallReview]=useState<WidgetInstallReview|null>(null);
  const [versionId,setVersionId]=useState<string|null>(null);
  const [officialForm,setOfficialForm]=useState<OfficialWidgetForm|null>(null);
  const [initialChoice,setInitialChoice]=useState<string|undefined>();
  const [pluginForm,setPluginForm]=useState<PluginWidgetForm|null>(null);
  const [form,setForm]=useState<WidgetInstanceForm|null>(null),[instanceResult,setInstanceResult]=useState<'pending'|'conflict'|null>(null),returnTarget=useRef<HTMLButtonElement|null>(null),returnItem=useRef<string|null>(null),requests=useRef(new Map<string,{operationId:string;expectedRevision:number;paused:boolean;expectedLayoutRevision:number}>());
  const restoreFocus=useCallback(()=>{
    requestAnimationFrame(()=>{
      if(returnTarget.current?.isConnected){returnTarget.current.focus();return;}
      const id=returnItem.current;
      const configure=id?document.querySelector<HTMLButtonElement>('[data-widget-instance="'+CSS.escape(id)+'"] [data-widget-configure]'):null;
      (configure??document.querySelector<HTMLButtonElement>('[data-widget-add]'))?.focus();
    });
  },[]);
  const browse=useCallback((subject:true|{pluginId:DistributedWidgetId;itemId:string},button?:HTMLButtonElement)=>{
    returnTarget.current=button??null;returnItem.current=subject===true?null:subject.itemId;setDirectory(subject);
  },[]);
  const configureInstalled=async(id:DistributedWidgetId)=>{
    if(!window.systemDockSettings)return;
    try {
      const {contributionId}=OFFICIAL_WIDGETS[id];
      const definitionId=nativeWidgetType(id,contributionId);
      if(definitionId)setOfficialForm(await window.systemDockSettings.officialWidgetPreview({definitionId}));
      else setPluginForm(await window.systemDockSettings.pluginWidgetForm({pluginId:id,contributionId}));
      setDirectory(null);
    }catch{setFailed(true);setDirectory(null);restoreFocus();}
  };
  const lock=useRef(false),operation=useRef<string|null>(null);
  const open=useCallback(async(id?:string)=>{
    if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);
    try{
      const route=await widgetPluginAuthoringDraft(id,i18n.language);
      operation.current=null;navigation?.close?.();navigate(route);
    }catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  },[navigate,i18n.language,navigation]);
  const configure=useCallback(async(id:string,button?:HTMLButtonElement)=>{
    if(snapshot?.instances.find(value=>value.id===id)?.installation==='source-review'){void open(snapshot.instances.find(value=>value.id===id)!.definitionId);return;}
    if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button??null;returnItem.current=id;
    try{const instance=snapshot?.instances.find(value=>value.id===id);if(!instance)throw new Error('Widget unavailable');
      if(instance.pluginId&&instance.contributionId){
        if(nativeWidgetType(instance.pluginId,instance.contributionId))setOfficialForm(await window.systemDockSettings.officialWidgetPreview({itemId:id}));
        else setPluginForm(await window.systemDockSettings.pluginWidgetForm({pluginId:instance.pluginId,contributionId:instance.contributionId,itemId:id}));
        return;
      }
      if(instance.installation==='install'||instance.installation==='update'||instance.installation==='preparing'||instance.installation==='repair'){setInstallReview(await window.systemDockSettings.widgetInstallReview({itemId:id}));return;}
      if(instance.definitionId.startsWith('builtin.'))setOfficialForm(await window.systemDockSettings.officialWidgetPreview({itemId:id}));else setForm(await window.systemDockSettings.instancePreview({itemId:id}));
    }catch(error){setFailed(!(error instanceof Error&&error.message.includes('WIDGET_PACKAGE_NOT_READY')));}finally{lock.current=false;setBusy(false);}
  },[snapshot,open]);
  const directoryAvailable=presentation.snapshot?.officialDirectory,refreshPresentation=presentation.refresh;
  const repair=useCallback(async(pluginId:OfficialWidgetId,button?:HTMLButtonElement)=>{
    if(lock.current||!window.systemDockSettings)return;
    lock.current=true;setBusy(true);setFailed(false);
    try{
      const result=await window.systemDockSettings.widgetDirectoryControl({kind:'repair',pluginId});
      if(result.kind!=='repair'||!result.repaired)throw new Error('Widget repair did not complete');
      refresh();
      refreshPresentation();
    }catch{setFailed(true);}finally{
      lock.current=false;setBusy(false);
      if(button)requestAnimationFrame(()=>{if(button.isConnected)button.focus();else restoreFocus();});
    }
  },[refresh,refreshPresentation,restoreFocus]);
  const install=useCallback(async(itemId:string,button?:HTMLButtonElement)=>{
    const official=snapshot?.instances.find(value=>value.id===itemId)?.officialWidget;
    if(official){
      if(directoryAvailable&&isDistributedWidgetId(official))browse({pluginId:official,itemId},button);
      else {returnItem.current=itemId;returnTarget.current=button??null;await repair(official,button);}
      return;
    }
    if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button??null;returnItem.current=itemId;
    try{setInstallReview(await window.systemDockSettings.widgetInstallReview({itemId}));}
    catch(error){setFailed(!(error instanceof Error&&error.message.includes('WIDGET_PACKAGE_NOT_READY')));}
    finally{lock.current=false;setBusy(false);}
  },[snapshot,directoryAvailable,browse,repair]);
  const uninstall=async(subject:{definitionId:string;sourceInstallationId:string},button:HTMLButtonElement)=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button;returnItem.current=null;
    setPicker(false);
    try{const value=await window.systemDockSettings.widgetLifecycleControl({kind:'uninstall-review',definitionId:subject.definitionId,sourceInstallationId:subject.sourceInstallationId});if(value.kind==='uninstall-review')setUninstallReview(value.review);}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const accountInstall=async(definition:WidgetAccountDefinition,button?:HTMLButtonElement)=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button??null;returnItem.current=null;setPicker(false);
    try{const value=await window.systemDockSettings.widgetLifecycleControl({kind:'definition-install-review',definitionId:definition.definitionId,sourceInstallationId:definition.sourceInstallationId,reference:definition.reference});if(value.kind==='install-review'){setPendingAdd(definition);setInstallReview(value.review);}}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const deleteDefinition=async(subject:{definitionId:string;sourceInstallationId?:string},button:HTMLButtonElement)=>{if(lock.current||!window.systemDockSettings||!subject.sourceInstallationId)return;lock.current=true;setBusy(true);setFailed(false);returnTarget.current=button;returnItem.current=null;
    setPicker(false);
    try{const value=await window.systemDockSettings.widgetLifecycleControl({kind:'definition-review',definitionId:subject.definitionId,sourceInstallationId:subject.sourceInstallationId});if(value.kind==='definition-review')setRetirementReview(value.review);}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const retryDeletion=async(operationId:string)=>{if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);try{await window.systemDockSettings.widgetLifecycleControl({kind:'definition-retry',operationId});refresh();}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}};
  const addInstalled=async()=>{if(!pendingAdd||!window.systemDockSettings)return;const definition=pendingAdd;setPendingAdd(null);setInstallReview(null);try{setForm(await window.systemDockSettings.savedWidgetPreview({definitionId:definition.definitionId,sourceInstallationId:definition.sourceInstallationId}));}catch{setFailed(true);}};
  const customize=useCallback(async(itemId:string)=>{
    if(lock.current||!window.systemDockSettings)return;lock.current=true;setBusy(true);setFailed(false);
    try{const instance=snapshot?.instances.find(value=>value.id===itemId);if(!instance?.pluginId||!instance.contributionId||instance.copyTarget)throw new Error('Widget source unavailable');
      const route=await pluginAuthoringDraft({pluginId:instance.pluginId,instanceId:itemId,copy:true},i18n.language);navigation?.close?.();navigate(route);
    }catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  },[navigate,snapshot,i18n.language,navigation]);
  const change=useCallback(async(instance:WidgetManagementSnapshot['instances'][number],remove=false)=>{
    if(lock.current||!window.systemDockSettings||!snapshot)return;lock.current=true;setBusy(true);setFailed(false);setInstanceResult(null);
    const key=instance.id+':'+(remove?'remove':instance.paused?'resume':'pause');
    let request=requests.current.get(key);if(!request){request={operationId:crypto.randomUUID(),expectedRevision:instance.mappingRevision??0,paused:!instance.paused,expectedLayoutRevision:snapshot.layoutRevision};requests.current.set(key,request);}
    try{
      if(instance.pluginId){if(!remove)throw new Error('Plugin Widget pause is unavailable');await window.systemDockSettings.removePluginWidget({itemId:instance.id,expectedLayoutRevision:snapshot.layoutRevision});requests.current.delete(key);refresh();return;}
      const receipt:WidgetInstanceReceipt=remove?await window.systemDockSettings.removeWidgetInstance({operationId:request.operationId,itemId:instance.id,expectedLayoutRevision:request.expectedLayoutRevision})
        :await window.systemDockSettings.setWidgetPaused({operationId:request.operationId,itemId:instance.id,expectedRevision:request.expectedRevision,paused:request.paused});
      if(receipt.status==='applied')requests.current.delete(key);else setInstanceResult(receipt.status);refresh();
    }catch{setFailed(true);}finally{lock.current=false;setBusy(false);}
  },[snapshot,refresh]);
  useEffect(()=>subscribeWidgetEntry(entry=>{
    if(!snapshot||lock.current)return;consumeWidgetEntry(entry.id);if(entry.expiresAt<=Date.now())return;navigation?.close?.();
    const request=entry.entry;
    if(request.kind==='new'){void open();return;}
    if(request.kind==='add'){refresh();setInitialChoice(request.definitionId);setPicker(true);return;}
    const instance=snapshot.instances.find(value=>value.id===request.itemId);if(!instance){setFailed(true);return;}
    if(request.kind==='install'){void install(instance.id);return;}
    if(request.kind==='configure')void configure(instance.id);
    else if(request.kind==='edit')void open(instance.definitionId);
    else if(request.kind==='fork')void customize(instance.id);
    else if(request.kind==='versions'){
      if(instance.pluginId)requestSettingsSection({section:'plugins',plugin:instance.pluginId});
      else setVersionId(instance.definitionId);
    }
    else if(request.kind==='remove')void change(instance,true);
    else if(instance.mappingRevision!==undefined)void change(instance);
  }),[snapshot,busy,open,configure,customize,change,navigation,refresh,install]);
  const definitionName=(id:string,sourceInstallationId?:string)=>
    snapshot?.installedDefinitions?.find(value=>value.definitionId===id&&value.sourceInstallationId===sourceInstallationId)?.name
    ?? snapshot?.definitions.find(value=>value.id===id&&(!sourceInstallationId||value.sourceInstallationId===sourceInstallationId))?.name
    ?? t('systemDock.widgets.states.definition-missing');
  const managedDefinitions=snapshot?.definitions.filter(definition=>definition.pluginId||definition.customizable!==false)??[];
  const order=new Map(presentation.snapshot?.items.map((item,index)=>[item.id,index]));
  const instances=[...(snapshot?.instances??[])].sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
  const addMenu=<WidgetAddMenu busy={busy||!snapshot} onBrowse={presentation.snapshot?.officialDirectory?()=>browse(true):undefined} onAdd={()=>{refresh();setInitialChoice(undefined);setPicker(true);}} onNew={()=>void open()}/>;
  if(!snapshot&&!state.failed)return <AppCatalogSkeleton label={t('common.loading')}/>;
  return <section data-dock-widgets="" className="widget-catalog space-y-6">
    {actionsContainer?createPortal(addMenu,actionsContainer):<div className="flex justify-end">{addMenu}</div>}
    <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground"><h2 className="font-medium">{t('systemDock.widgets.catalog.title')}</h2><span>{t('systemDock.widgets.catalog.count',{count:instances.length})}</span></div>
    {(failed||state.failed||presentation.failed)&&<SettingsAlert><span role="alert">{t('systemDock.widgets.failed')}</span><SettingsButton variant="ghost" onClick={()=>{state.refresh();presentation.refresh();}}>{t('common.retry')}</SettingsButton></SettingsAlert>}
    {instanceResult&&<SettingsAlert><span role="alert">{t(instanceResult==='conflict'?'systemDock.widgets.conflict':'systemDock.widgets.instancePending')}</span></SettingsAlert>}
    {snapshot?.retirements?.map(value=><SettingsAlert key={value.operationId}><p>{value.name}: {t('systemDock.widgets.definitionDelete.pending')}</p><SettingsButton disabled={busy} variant="outline" onClick={()=>void retryDeletion(value.operationId)}>{t('common.retry')}</SettingsButton></SettingsAlert>)}
    {instances.length?<div className="widget-catalog-grid">{instances.map(instance=>{
      const item=presentation.snapshot?.items.find(value=>value.id===instance.id);
      return <WidgetInstanceCard key={instance.id} instance={instance} definitionName={definitionName(instance.definitionId,instance.sourceInstallationId)} busy={busy}
        bundled={Boolean(instance.officialWidget&&!(directoryAvailable&&isDistributedWidgetId(instance.officialWidget)))} wide={item?.widget?.type==='custom'&&item.widget.size!=='small'&&presentation.snapshot?.edge==='bottom'}
        preview={item&&presentation.snapshot?<WidgetCatalogPreview item={item} presentation={presentation.snapshot} active={active&&!picker&&!directory} ready={presentation.ready.has(item.id)} observe={presentation.observe} now={now} t={t}/>:<div className="widget-catalog-preview"><span className="text-xs text-muted-foreground">{t(presentation.failed?'systemDock.item.unavailable':'common.loading')}</span></div>}
        onConfigure={button=>void configure(instance.id,button)} onInstall={button=>void install(instance.id,button)} onEdit={()=>void open(instance.definitionId)} onCopy={()=>void customize(instance.id)}
        onVersions={()=>{if(instance.pluginId||instance.officialWidget)requestSettingsSection({section:'plugins',plugin:instance.pluginId??instance.officialWidget});else setVersionId(instance.definitionId);}} onChange={remove=>void change(instance,remove)}>
        <WidgetDeliveryStatus deliveries={snapshot?.deliveries?.filter(value=>value.definitionId===instance.definitionId)??[]} onChanged={refresh}/>
        {item?.widget?.type==='custom'&&item.widget.summaryError&&<p role="status" className="mt-2 text-xs text-muted-foreground">{t('systemDock.widgets.summaryRefreshFailed')}</p>}
        {instance.copyTarget&&<div data-widget-copy-state={instance.copyTarget.status} role={instance.copyTarget.status==='error'?'alert':'status'} className={instance.copyTarget.status==='error'?'mt-2 text-xs text-destructive':'mt-2 text-xs text-muted-foreground'}><p>{t(instance.copyTarget.status==='error'?'systemDock.widgets.copyFailed':'systemDock.widgets.copyPending')}</p>{instance.copyTarget.error&&<p className="mt-1 line-clamp-3 break-words">{instance.copyTarget.error}</p>}<SettingsButton variant="ghost" onClick={()=>requestSettingsSection({section:'plugins',plugin:instance.copyTarget!.pluginId})}>{t('systemDock.widgets.copyDetails')}</SettingsButton></div>}
      </WidgetInstanceCard>;
    })}</div>:snapshot?<div className="grid justify-items-center gap-4 py-16 text-center"><p className="text-sm text-muted-foreground">{t('systemDock.widgets.catalog.empty')}</p><SettingsButton variant="outline" disabled={busy} onClick={()=>{refresh();setInitialChoice(undefined);setPicker(true);}}>{t('systemDock.widgets.addExisting')}</SettingsButton></div>:null}
    {directory&&<Suspense fallback={null}><WidgetDirectoryDialog subject={directory===true?null:directory} onClose={()=>setDirectory(null)}
      onChanged={()=>{refresh();presentation.refresh();}} onAdd={configureInstalled} onReturnFocus={restoreFocus}/></Suspense>}
    {retirementReview&&<Suspense fallback={null}><WidgetUninstallDialog mode="definition" review={retirementReview} onClose={()=>setRetirementReview(null)} onChanged={refresh} onReturnFocus={restoreFocus}/></Suspense>}
    {uninstallReview&&<Suspense fallback={null}><WidgetUninstallDialog review={uninstallReview} onClose={()=>setUninstallReview(null)} onChanged={refresh} onReturnFocus={restoreFocus}/></Suspense>}
    {installReview&&<Suspense fallback={null}><WidgetInstallDialog review={installReview} onClose={()=>{setInstallReview(null);setPendingAdd(null);}} onInstalled={pendingAdd?()=>void addInstalled():undefined} onChanged={refresh} onConfigure={itemId=>{setInstallReview(null);void configure(itemId);}} onReturnFocus={restoreFocus}/></Suspense>}
    {picker&&state.snapshot&&<WidgetPicker snapshot={state.snapshot} presentation={{...presentation,now,active}} initialChoice={initialChoice} onClose={()=>{setPicker(false);restoreFocus();}} onOfficial={value=>{setPicker(false);setOfficialForm(value);}} onPersonal={value=>{setPicker(false);setForm(value);}} onPlugin={value=>{setPicker(false);setPluginForm(value);}} onInstall={value=>void accountInstall(value)} management={managedDefinitions.length||snapshot?.installedDefinitions?.length||snapshot?.accountDefinitions?.length?<>
      {managedDefinitions.map(definition=><div key={definition.id} data-widget-definition={definition.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
        <span>{definition.name}{definition.installation==='disabled'&&<> · {t('systemDock.widgets.states.paused')}</>}</span>
        <div className="flex flex-wrap gap-2">
          {definition.installation==='needs-install'&&definition.officialWidget&&!(directoryAvailable&&isDistributedWidgetId(definition.officialWidget))
            ? <SettingsButton variant="outline" disabled={busy} onClick={event=>void repair(definition.officialWidget!,event.currentTarget)}>{t('systemDock.widgets.install.repair')}</SettingsButton>
            : <SettingsButton variant="ghost" disabled={busy} onClick={()=>{
              setPicker(false);
              if(definition.pluginId)requestSettingsSection({section:'plugins',plugin:definition.pluginId});
              else setVersionId(definition.id);
            }}>{t('systemDock.widgets.versions')}</SettingsButton>}
          {definition.customizable!==false&&(definition.pluginId
            ? <SettingsButton variant="ghost" disabled={busy} onClick={()=>void open(definition.id)}>{t('systemDock.widgets.edit')}</SettingsButton>
            : <SettingsButton variant="ghost" disabled={busy||!definition.sourceInstallationId} onClick={event=>void deleteDefinition({definitionId:definition.id,sourceInstallationId:definition.sourceInstallationId},event.currentTarget)}>{t('systemDock.widgets.definitionDelete.confirm')}</SettingsButton>)}
        </div>
      </div>)}
      {failed&&<SettingsAlert><span role="alert">{t('systemDock.widgets.failed')}</span></SettingsAlert>}
      <WidgetAccountDefinitions installed={snapshot?.installedDefinitions??[]} available={(snapshot?.accountDefinitions??[]).filter(value=>!snapshot?.installedDefinitions?.some(other=>other.definitionId===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId)&&!snapshot?.definitions.some(other=>other.id===value.definitionId&&other.sourceInstallationId===value.sourceInstallationId))} busy={busy} onAdd={key=>{refresh();setInitialChoice(key);setPicker(true);}} onInstall={(value,button)=>void accountInstall(value,button)} onUninstall={(value,button)=>void uninstall(value,button)} onDelete={(value,button)=>void deleteDefinition(value,button)}/>
    </>:undefined} />}
    {officialForm&&<Suspense fallback={null}><OfficialWidgetDialog key={officialForm.previewId} form={officialForm} onClose={()=>setOfficialForm(null)} onChanged={state.refresh} onReturnFocus={restoreFocus}/></Suspense>}
    {pluginForm&&<PluginWidgetFormDialog key={`${pluginForm.pluginId}/${pluginForm.contributionId}/${pluginForm.itemId??"new"}`} form={pluginForm} edge={presentation.snapshot?.edge??'bottom'} onClose={()=>setPluginForm(null)} onChanged={state.refresh} onReturnFocus={restoreFocus}/>}
    {form&&<WidgetInstanceFormDialog key={form.previewId} form={form} onClose={()=>setForm(null)} onChanged={state.refresh} onReturnFocus={restoreFocus} />}
    {versionId&&<Suspense fallback={null}><WidgetVersionsDialog key={versionId} definitionId={versionId} onClose={()=>setVersionId(null)} onChanged={state.refresh} onReturnFocus={restoreFocus}/></Suspense>}
  </section>;
}
