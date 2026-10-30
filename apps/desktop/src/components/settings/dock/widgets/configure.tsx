/**
 * [INPUT]: Depends on trusted Widget commands, typed settings, metadata-only Base fields/filters, Main-held API reviews, strict names and the shared accessible Dialog.
 * [OUTPUT]: Provides retained non-secret instance drafts, explicit Base/API consent, host-only credential controls, stable operation identities and truthful failure feedback.
 * [POS]: Shared main-window Widget form; source application and instance configuration retain separate submission owners.
 */
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from '@ai-chat/ui/components/ui/dialog';
import {defaultDockSettings,validateDockSettings,widgetNameSchema,type DockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {DockSummarySize} from '@bottega/contracts/plugins/dock/geometry';
import type {WidgetApplyInput,WidgetPreview} from '../../../../../shared/system-dock/widgets/authoring';
import {dockBaseBindingSchema,type DockBaseBinding} from '../../../../../shared/system-dock/widgets/instance';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsAlert,SettingsButton} from '@/components/settings/settings-layout';
import {WidgetSettingsFields,parsedWidgetSettings} from '@/components/settings/dock/widgets/fields';
import {WidgetBaseBindings} from './base';
import {WidgetApiConfiguration} from './api';
export type WidgetConfigurationDraft={name:string;size:DockSummarySize;settings:DockSettings;bindings?:DockBaseBinding[];baseConsent?:boolean;apiConsent?:string[]};
type FormPreview=Pick<WidgetPreview,'previewId'|'name'|'dock'>&{itemId?:string|null};
export function widgetConfigurationDraft(preview:Pick<WidgetPreview,'name'|'dock'>,previous:WidgetConfigurationDraft|null):WidgetConfigurationDraft{
 return{name:previous?.name??preview.name,size:previous&&preview.dock.sizes.includes(previous.size)?previous.size:preview.dock.sizes[0]!,
  settings:{...defaultDockSettings(preview.dock.settings),...Object.fromEntries(preview.dock.settings.flatMap(field=>previous&&Object.hasOwn(previous.settings,field.id)?[[field.id,previous.settings[field.id]!]]:[]))},bindings:previous?.bindings??[],baseConsent:previous?.baseConsent??false,apiConsent:[]};
}
export function WidgetConfiguration({preview,draft,onDraft,onSubmit,onClose,onReturnFocus,kind='source',bindings=[],onRevoke}:{preview:FormPreview;draft:WidgetConfigurationDraft;onDraft(value:WidgetConfigurationDraft):void;
 onSubmit(input:WidgetApplyInput):Promise<'success'|'conflict'|'pending'>;onClose():void;onReturnFocus():void;kind?:'source'|'add'|'configure'|'review'|'preview';bindings?:readonly DockBaseBinding[];onRevoke?():Promise<void>}){
 const hasApi=preview.dock.data.some(source=>source.kind==='api'),apiSettings=parsedWidgetSettings(preview.dock.settings,draft.settings),apiKey=JSON.stringify([preview.previewId,preview.itemId??null,apiSettings]);
 const {t}=useAppTranslation(),[busy,setBusy]=useState(false),[failureCode,setFailureCode]=useState<'conflict'|'commitPending'|'applyFailed'|null>(null),[invalid,setInvalid]=useState<string[]>([]),[invalidName,setInvalidName]=useState(false),[invalidBase,setInvalidBase]=useState(false),[invalidApi,setInvalidApi]=useState(false),[apiReady,setApiReady]=useState(!hasApi),lock=useRef(false),operation=useRef<WidgetApplyInput|null>(null),sources=preview.dock.data.filter(source=>source.kind==='base');
 const change=(value:WidgetConfigurationDraft)=>{const rangeChanged=sources.some(source=>[source.fromSetting,source.toSetting].some(id=>id&&draft.settings[id]!==value.settings[id])),settingsChanged=JSON.stringify(draft.settings)!==JSON.stringify(value.settings);onDraft({...value,baseConsent:rangeChanged?false:value.baseConsent,apiConsent:settingsChanged?[]:value.apiConsent});if(settingsChanged&&hasApi)setApiReady(false);operation.current=null;setFailureCode(null);setInvalid([]);setInvalidName(false);setInvalidBase(false);setInvalidApi(false);};
 const submit=async()=>{
  if(lock.current)return;const settings=parsedWidgetSettings(preview.dock.settings,draft.settings),fields=validateDockSettings(preview.dock.settings,settings),name=widgetNameSchema.safeParse(draft.name);
  const selected=draft.bindings??[...bindings],badBase=sources.length>0&&(!draft.baseConsent||selected.some(binding=>!dockBaseBindingSchema.safeParse(binding).success)||sources.some(source=>{const binding=selected.find(binding=>binding.slot===source.binding);return!binding||[source.field,source.timeField].some(field=>field&&!Object.hasOwn(binding.fields,field));}));
  const badApi=hasApi&&!apiReady;setInvalid(fields);setInvalidName(!name.success);setInvalidBase(badBase);setInvalidApi(badApi);if(fields.length||!name.success||badBase||badApi)return;
  lock.current=true;setBusy(true);setFailureCode(null);
  operation.current??={operationId:crypto.randomUUID(),previewId:preview.previewId,name:name.data,size:draft.size,settings,bindings:selected,baseConsent:draft.baseConsent??false,apiConsent:draft.apiConsent??[]};
  try{const result=await onSubmit(operation.current);if(result==='success')onClose();else setFailureCode(result==='conflict'?'conflict':'commitPending');}
  catch(failure){setFailureCode(String(failure).includes('CONFLICT')||String(failure).includes('EXPIRED')?'conflict':'applyFailed');}
  finally{lock.current=false;setBusy(false);}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent showCloseButton={!busy} className="max-h-[85vh] overflow-y-auto" onCloseAutoFocus={event=>{event.preventDefault();onReturnFocus();}} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
  <DialogTitle>{t('systemDock.widgets.configure')}</DialogTitle><DialogDescription>{t(kind==='preview'?'systemDock.widgets.previewConsentHint':'systemDock.widgets.configurationHint')}</DialogDescription>
  <label className="grid gap-2 text-sm">{t('systemDock.widgets.name')}<input value={draft.name} disabled={busy} readOnly={kind==='review'} aria-invalid={invalidName} onChange={event=>change({...draft,name:event.target.value})} className="min-h-10 rounded-md border bg-transparent px-3" /></label>
  {preview.dock.sizes.length>1&&<label className="grid gap-2 text-sm">{t('systemDock.settings.size')}<select disabled={busy} value={draft.size} onChange={event=>change({...draft,size:event.target.value as DockSummarySize})} className="min-h-10 rounded-md border bg-transparent px-3">{preview.dock.sizes.map(size=><option key={size} value={size}>{t(size==='small'?'systemDock.widgets.sizeSmall':size==='medium'?'systemDock.widgets.sizeMedium':'systemDock.widgets.sizeLarge')}</option>)}</select></label>}
  <WidgetSettingsFields fields={preview.dock.settings} values={draft.settings} disabled={busy} invalid={invalid} onChange={settings=>change({...draft,settings})} />
  {sources.length>0&&<><WidgetBaseBindings dock={preview.dock} bindings={draft.bindings??bindings} disabled={busy} onChange={bindings=>change({...draft,bindings,baseConsent:false})}/><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.baseConsent??false} disabled={busy} onChange={event=>change({...draft,baseConsent:event.target.checked})}/><span>{t('systemDock.widgets.base.consent')}</span></label>
   {onRevoke&&<SettingsButton variant="outline" disabled={busy} onClick={()=>{if(lock.current)return;lock.current=true;setBusy(true);void onRevoke().catch(()=>setFailureCode('applyFailed')).finally(()=>{lock.current=false;setBusy(false);});}}>{t('systemDock.widgets.base.revoke')}</SettingsButton>}</>}
  {hasApi&&<WidgetApiConfiguration key={apiKey} previewId={preview.previewId} targetId={preview.itemId??undefined} settings={apiSettings} consent={draft.apiConsent??[]} disabled={busy} onConsent={apiConsent=>change({...draft,apiConsent})} onReady={setApiReady}/>}
  <p className="text-xs text-muted-foreground">{t('systemDock.widgets.executionHere')}</p>
  {(failureCode||invalidName||invalidBase||invalidApi||invalid.length>0)&&<SettingsAlert>{t(invalidName?'systemDock.widgets.invalidName':invalid.length?'systemDock.widgets.invalidSettings':invalidBase?'systemDock.widgets.base.invalid':invalidApi?'systemDock.widgets.api.invalid':failureCode==='conflict'?'systemDock.widgets.conflict':failureCode==='commitPending'?(kind==='source'?'systemDock.widgets.commitPending':'systemDock.widgets.instancePending'):'systemDock.widgets.applyFailed')}</SettingsAlert>}
  <DialogFooter><SettingsButton variant="outline" disabled={busy} onClick={onClose}>{t('systemDock.widgets.cancel')}</SettingsButton><SettingsButton disabled={busy} aria-busy={busy} onClick={()=>void submit()}>{t(busy?(kind==='preview'?'systemDock.widgets.previewStarting':'systemDock.widgets.applying'):kind==='preview'?'systemDock.widgets.previewStartReal':kind==='review'?'systemDock.widgets.review.save':kind==='source'?'systemDock.widgets.saveAndAdd':kind==='add'?'systemDock.widgets.add':'systemDock.widgets.applyInstance')}</SettingsButton></DialogFooter>
 </DialogContent></Dialog>;
}
