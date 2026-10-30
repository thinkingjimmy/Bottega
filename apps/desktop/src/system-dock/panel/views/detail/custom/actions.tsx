/**
 * [INPUT]: Depends on host-issued opaque actions and the trusted panel's awaited command result.
 * [OUTPUT]: Provides WidgetDetailActions with immediate busy feedback, duplicate-click suppression and a retained failure state.
 * [POS]: Standard host detail controls; isolated author code uses its separate gesture-checked Dock SDK.
 */
import {useRef,useState} from 'react';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';
import {usePanel} from '../../../context';
export function WidgetDetailActions({itemId,actions}:{itemId:string;actions:readonly DockAction[]}){
 const {perform,t}=usePanel(),[busy,setBusy]=useState<string|null>(null),[failed,setFailed]=useState(false),locked=useRef(false);
 const run=async(ref:string)=>{
  if(locked.current)return;locked.current=true;setBusy(ref);setFailed(false);
  try{if(!await perform({kind:'widget-action',itemId,ref}))setFailed(true);}
  finally{locked.current=false;setBusy(null);}
 };
 return <>{actions.map(action=><button key={action.ref} type="button" className="text-button" disabled={busy!==null} aria-busy={busy===action.ref||undefined} onClick={()=>void run(action.ref)}>{action.label}</button>)}
 {failed&&<p role="alert" className="note">{t('systemDock.widgets.actions.failed')}</p>}</>;
}
