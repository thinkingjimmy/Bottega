/**
 * [INPUT]: Main-owned bounded plugin catalog pages, exact hosted Base page declarations and changed notifications.
 * [OUTPUT]: waitForPromotedPlugin resolves only the actual canonical Base plugin/page after original conversion succeeds.
 * [POS]: Save dialog receipt-to-navigation boundary; never fabricates plugin identity or repeats the data conversion.
 */
import {pluginPlatformBridge} from '@/lib/plugin-platform/client';
export function waitForPromotedPlugin(appId:string,unavailable:string):Promise<{pluginId:string;contributionId:string}>{
  const bridge=pluginPlatformBridge();if(!bridge)return Promise.reject(new Error(unavailable));
  return new Promise((resolve,reject)=>{
    let complete=false,reading=false,again=false,stop=()=>{};
    const finish=(value:{pluginId:string;contributionId:string}|Error)=>{if(complete)return;complete=true;clearTimeout(timer);stop();if(value instanceof Error)reject(value);else resolve(value);};
    const timer=setTimeout(()=>finish(new Error(unavailable)),10_000);
    const load=async()=>{if(complete)return;if(reading){again=true;return;}reading=true;
      try{do{again=false;let cursor:string|undefined,revision:number|undefined;const matches:{pluginId:string;contributionId:string}[]=[];
        do{const page=await bridge.list({limit:100,...(cursor?{cursor}:{})});if(complete)return;
          if(revision!==undefined&&page.revision!==revision)throw new Error(unavailable);revision=page.revision;
          const candidates=await Promise.all(page.items.filter(item=>item.manifest.source.format==='base-app').map(item=>bridge.get(item.manifest.id)));if(complete)return;
          for(const item of candidates){if(!item||item.manifest.source.format!=='base-app'||item.status==='installed')continue;
            const entry=item.manifest.contributions.find(value=>value.kind==='page'&&value.hostAppId===appId);if(entry)matches.push({pluginId:item.manifest.id,contributionId:entry.id});}
          cursor=page.nextCursor;
        }while(cursor);
        if(matches.length>1)throw new Error(unavailable);if(matches.length===1){finish(matches[0]!);return;}
      }while(again&&!complete);}catch(cause){finish(cause instanceof Error?cause:new Error(String(cause)));}finally{reading=false;}
    };
    stop=bridge.onChanged(()=>void load());void load();
  });
}
