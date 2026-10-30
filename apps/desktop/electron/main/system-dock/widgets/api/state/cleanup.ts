/**
 * [INPUT]: Depends on exact API ledger schema and durable publication without native decryption.
 * [OUTPUT]: Provides clearApiAccountFile for unopened-owner account cleanup.
 * [POS]: Cold account cleanup leaf; the existing account cleanup barrier supplies cross-owner serialization.
 */
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {DurableJson} from '../../../../persistence/durable-json';
import {apiStateSchema} from './model';

export async function clearApiAccountFile(userData:string,accountId:string){
 const path=join(userData,'dock-widget-api.json'),info=await lstat(path).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
 if(!info)return;if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024)throw new Error('DOCK_API_STATE_INVALID');
 const file=new DurableJson(path,apiStateSchema,()=>({version:1 as const,slots:[],grants:[],associations:[]}));
 await file.initialize();
 try{await file.mutate(state=>{state.slots=state.slots.filter(item=>item.owner.accountId!==accountId);state.grants=state.grants.filter(item=>item.owner.accountId!==accountId);state.associations=state.associations.filter(item=>item.draft.accountId!==accountId&&item.target.accountId!==accountId);});}
 finally{await file.closeAndFlush();}
}
