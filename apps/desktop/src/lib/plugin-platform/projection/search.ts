/**
 * [INPUT]: React effects and bounded source summary search with exact cursors.
 * [OUTPUT]: usePluginSearch with independent pagination and query-generation fencing.
 * [POS]: On-demand work-object search; it never mutates management or runtime pagination.
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import type {UnifiedPluginCatalogPage} from '@bottega/contracts/plugins/platform';
import {pluginPlatformBridge} from '../client';
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
type CatalogState={page:UnifiedPluginCatalogPage|null;error:string;busy:boolean};
/** Search has its own cursor; management paging never changes source-object discovery. */
export function usePluginSearch(search:string,active:boolean){
  const [state,setState]=useState<CatalogState>({page:null,busy:false,error:''}),generation=useRef(0),query=search.trim();
  const invalidate=useCallback(()=>++generation.current,[]);
  const load=useCallback(async(cursor?:string)=>{const bridge=pluginPlatformBridge();if(!bridge||!active||!query)return;const request=invalidate();setState(previous=>({...previous,busy:true}));
    try{const page=await bridge.list({limit:100,search:query,...(cursor?{cursor}:{})});if(request===generation.current)setState(previous=>({page:cursor&&previous.page?.revision===page.revision?{...page,items:[...previous.page.items,...page.items]}:page,error:'',busy:false}));}
    catch(cause){if(request===generation.current)setState(previous=>({...previous,error:message(cause),busy:false}));}},[active,query,invalidate]);
  useEffect(()=>{invalidate();if(!active||!query)return;setState({page:null,busy:true,error:''});const timer=setTimeout(()=>void load(),120);return()=>{invalidate();clearTimeout(timer);};},[query,active,load,invalidate]);
  return{...state,items:state.page?.items??[],loadMore:()=>load(state.page?.nextCursor)};
}
