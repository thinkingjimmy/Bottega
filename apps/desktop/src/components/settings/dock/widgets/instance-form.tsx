/**
 * [INPUT]: Depends on main-owned instance form receipts and the shared typed Widget confirmation controls.
 * [OUTPUT]: Provides independent instance configuration/addition and revision-fenced Base revocation while retaining drafts and original operations.
 * [POS]: Settings form adapter; the source Chat owns definition application separately.
 */
import {useRef,useState} from 'react';
import type {WidgetInstanceForm} from '../../../../../shared/system-dock/widgets/management';
import {WidgetConfiguration,type WidgetConfigurationDraft} from './configure';
export function WidgetInstanceFormDialog({form,onClose,onChanged,onReturnFocus}:{form:WidgetInstanceForm;onClose():void;onChanged():void;onReturnFocus():void}){
 const [draft,setDraft]=useState<WidgetConfigurationDraft>({name:form.name,size:form.widget.size,settings:form.widget.settings,bindings:[...form.widget.bindings],baseConsent:form.baseAuthorized}),revoke=useRef<string|null>(null);
 return <WidgetConfiguration preview={form} draft={draft} onDraft={setDraft} kind={form.itemId?'configure':'add'} bindings={form.widget.bindings} onClose={onClose} onReturnFocus={onReturnFocus}
  onRevoke={form.itemId&&form.baseAuthorized?async()=>{revoke.current??=crypto.randomUUID();const result=await window.systemDockSettings!.revokeWidgetBaseAccess({operationId:revoke.current,itemId:form.itemId!,expectedRevision:form.mappingRevision!});if(result.status!=='applied')throw new Error('DOCK_BASE_REVOCATION_PENDING');onChanged();onClose();}:undefined}
  onSubmit={async input=>{const result=await window.systemDockSettings!.submitWidgetInstance(input);onChanged();return result.status==='applied'?'success':result.status==='conflict'?'conflict':'pending';}} />;
}
