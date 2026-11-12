/**
 * [INPUT]: Plugin and contribution identities plus parent-supplied theme, Widget view context and instance configuration.
 * [OUTPUT]: Isolated Surface RPC bootstrap and Bottega-mapped shadcn foundation styles.
 * [POS]: UI compiler payload; no host DOM access or backend credentials enter the iframe.
 */
export function pluginContextBootstrap(pluginId:string,contributionId:string,features:readonly string[]=[]){return`
const pending=new Map();let sequence=0;
const api={configuration:{},context:null,call(method,input){return new Promise((resolve,reject)=>{const requestId=String(++sequence);const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Plugin request timed out'));},30000);pending.set(requestId,{resolve,reject,timer});parent.postMessage({type:'bottega-plugin-rpc',pluginId:${JSON.stringify(pluginId)},contributionId:${JSON.stringify(contributionId)},requestId,method,input},'*');});}};
Object.defineProperty(window,'bottega',{value:api});
const pluginWorkers=new Set();const NativeWorker=globalThis.Worker;
function ManagedWorker(url,options={}){
 if(!${features.includes('worker')})throw new Error('This plugin has not declared Worker support');
 if(pluginWorkers.size>=4)throw new Error('This plugin has reached its four-worker limit');
 const base=new URL('./',import.meta.url),target=new URL(url,base);
 if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname)||!target.pathname.includes('/workers/'))throw new Error('Worker must use a bundled plugin asset');
 const code=globalThis[Symbol.for('bottega.plugin.workerAssets')]?.get(target.href);
 if(typeof code!=='string')throw new Error('Worker asset is not in this plugin bundle');
 const script='const __bottegaWorkerAssetUrl='+JSON.stringify(target.href)+';\\n'+code;
 const worker=new NativeWorker('data:application/javascript,'+encodeURIComponent(script),{...options,type:'module',credentials:'omit'});
 const stop=worker.terminate.bind(worker);worker.terminate=()=>{if(pluginWorkers.delete(worker))stop();};
 pluginWorkers.add(worker);worker.addEventListener('error',()=>worker.terminate(),{once:true});return worker;
}
if(NativeWorker){ManagedWorker.prototype=NativeWorker.prototype;Object.setPrototypeOf(ManagedWorker,NativeWorker);Object.defineProperty(globalThis,'Worker',{value:ManagedWorker});}
addEventListener('message',event=>{if(event.source!==parent)return;const value=event.data;if(value?.type==='bottega-plugin-context'){api.configuration=value.configuration??{};api.context=value.presentation??null;for(const [name,color]of Object.entries(value.theme??{}))if(name.startsWith('--')&&typeof color==='string')document.documentElement.style.setProperty(name,color);dispatchEvent(new CustomEvent('bottega-context-changed'));}if(value?.type==='bottega-plugin-rpc-result'){const call=pending.get(value.requestId);if(call){clearTimeout(call.timer);pending.delete(value.requestId);value.error?call.reject(new Error(value.error)):call.resolve(value.result);}}});
addEventListener('pagehide',()=>{for(const worker of pluginWorkers)worker.terminate();for(const value of pending.values()){clearTimeout(value.timer);value.reject(new Error('Plugin surface closed'));}pending.clear();},{once:true});
`;}
export const PLUGIN_THEME_CSS=`:root{color-scheme:light dark;--background:light-dark(oklch(1 0 0),oklch(.18 0 0));--foreground:light-dark(oklch(.18 0 0),oklch(.96 0 0));--card:light-dark(oklch(1 0 0),oklch(.23 0 0));--card-foreground:var(--foreground);--popover:var(--card);--popover-foreground:var(--foreground);--primary:light-dark(oklch(.25 0 0),oklch(.92 0 0));--primary-foreground:var(--background);--secondary:light-dark(oklch(.96 0 0),oklch(.28 0 0));--secondary-foreground:var(--foreground);--muted:var(--secondary);--muted-foreground:light-dark(oklch(.5 0 0),oklch(.7 0 0));--accent:var(--secondary);--accent-foreground:var(--foreground);--destructive:oklch(.6 .2 25);--border:light-dark(oklch(.9 0 0),oklch(.34 0 0));--input:var(--border);--ring:var(--primary);--radius:.5rem}*{border-color:var(--border)}body{margin:0;background:var(--background);color:var(--foreground);font-family:system-ui}button,input,textarea,select{font:inherit}button{cursor:pointer}button:disabled{cursor:default}`;
