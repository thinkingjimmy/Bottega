/**
 * [INPUT]: One fixed native token and complete authenticated source/runtime members over an exact parent-owned private port.
 * [OUTPUT]: Credential-free opaque original editor with bounded Blob resources, explicit private-owner teardown and a module-owned remote native HTTP adapter and exact read-only runtime source for opaque descendants.
 * [POS]: Remote native frame bootstrap; authored descendant frames never receive its private port or transport.
 */
export function nativeBootstrap(token: string, parentOrigin: string) {
  const source = String.raw`(()=>{
    const token=${JSON.stringify(token)},parentOrigin=${JSON.stringify(parentOrigin)},pending=new Map(),queued=[],urls=[],files=new Map();let port,active=true,connected=false,cleanupResources=()=>{};
    const fail=error=>parent.postMessage({type:'bottega:native:error',token,message:String(error?.message||error).slice(0,300)},parentOrigin);
    const pump=()=>{while(active&&port&&pending.size<4&&queued.length){
      const work=queued.shift(),{id,path,init,resolve,reject}=work;pending.set(id,work);
      void(async()=>{try{
        const headers=new Headers(init.headers),method=(init.method||'GET').toUpperCase();let body;
        if(init.body!==undefined&&init.body!==null){const blob=init.body instanceof Blob?init.body:new Blob([init.body]);if(blob.size>24*1024*1024)throw new Error('Native request exceeds its byte budget');body=await blob.arrayBuffer()}
        if(!active||!pending.has(id))throw new Error('Native remote view closed');
        port.postMessage({id,path,method,requestId:headers.get('x-bottega-request')||'native-'+id,contentType:headers.get('content-type')||undefined,filename:headers.get('x-bottega-filename')||undefined,nonce:headers.get('x-bottega-final-flush')||undefined,body},body?[body]:[])
      }catch(error){pending.delete(id);reject(error);pump()}})()
    }};
    const ask=(path,init={})=>new Promise((resolve,reject)=>{
      if(!active||pending.size+queued.length>=20){reject(new Error('Native transport is unavailable or busy'));return}
      queued.push({id:crypto.randomUUID(),path,init,resolve,reject});pump()
    });
    const mime=path=>({'js':'text/javascript','css':'text/css','svg':'image/svg+xml','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','webp':'image/webp','woff2':'font/woff2','woff':'font/woff','ttf':'font/ttf','otf':'font/otf','json':'application/json','html':'text/html'})[path.split('.').pop().toLowerCase()]||'application/octet-stream';
    const safe=path=>typeof path==='string'&&path.length<=240&&!path.startsWith('/')&&!path.includes(String.fromCharCode(92))&&!path.includes(String.fromCharCode(0))&&!/[?#]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');
    const create=(bytes,type)=>{const url=URL.createObjectURL(new Blob([bytes],{type}));urls.push(url);return url};
    const renderResource=(bytes,type)=>{if(type.startsWith('image/')||type.startsWith('font/')){let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return 'data:'+type+';base64,'+btoa(binary)}return create(bytes,type)};
    const initialize=async value=>{
      if(connected||!Array.isArray(value.source)||!Array.isArray(value.runtime)||value.source.length>512||value.runtime.length>32)throw new Error('The complete native closure is invalid');connected=true;
      let total=0;for(const [group,prefix]of [[value.runtime,''],[value.source,'project/']])for(const member of group){if(!safe(member.path)||!(member.data instanceof Uint8Array)||files.has(prefix+member.path))throw new Error('Native member identity is invalid');total+=member.data.byteLength;if(total>96*1024*1024)throw new Error('Native closure exceeds its byte budget');files.set(prefix+member.path,member.data)}
      if(files.has('artifact-type/dc-runtime.js')&&!files.has('project/support.js'))files.set('project/support.js',files.get('artifact-type/dc-runtime.js'));
      const resources=new Map();for(const[path,bytes]of files){
        const type=mime(path);
        if(path.startsWith('project/'))resources.set(path,renderResource(bytes,type))
        else resources.set(path,create(bytes,type));
      }
      for(const[path,url]of resources){const match=/^project\/assets\/([a-f0-9]{32})\.[a-z0-9]+$/.exec(path);if(match)resources.set('_blob/'+match[1],url)}
      if(resources.has('artifact-type/dc-runtime.js')&&!resources.has('project/support.js'))resources.set('project/support.js',resources.get('artifact-type/dc-runtime.js'));
      cleanupResources=()=>resources.clear();
      const resource=path=>active?resources.get(String(path).replace(/^\//,''))||null:null,base='https://native.invalid/editor/';
      const nativeFetch=async(input,init={})=>{
        if(!active)throw new Error('Native remote view closed');
        const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url,url=new URL(raw,base);
        if(url.origin!=='https://native.invalid'||url.search||url.hash)throw new Error('Native transport rejected a foreign resource');
        const path=decodeURIComponent(url.pathname).replace(/^\/editor\//,'');
        if(!url.pathname.startsWith('/editor/')||!safe(path))throw new Error('Native transport rejected a path');
        if((init.method||'GET').toUpperCase()==='GET'&&files.has(path))return new Response(files.get(path),{headers:{'content-type':mime(path)}});
        const result=await ask(path,init);if(result.error)throw new Error(result.error);
        if((init.method||'GET').toUpperCase()==='POST'&&result.status===200){
          if(path==='__deck/publish'){
            const text=typeof init.body==='string'?init.body:await new Response(init.body).text(),batch=JSON.parse(text).files;
            for(const[name,value]of Object.entries(batch)){
              if(!name.startsWith('project/')||!safe(name))throw new Error('Native cached source path changed');
              if(value===null||value.delete){files.delete(name);resources.delete(name);continue}
              const bytes=Uint8Array.from(atob(value.base64),char=>char.charCodeAt(0));files.set(name,bytes);resources.set(name,renderResource(bytes,mime(name)));
            }
          }else if(path==='__deck/assets'){
            const receipt=JSON.parse(new TextDecoder().decode(result.body)),type=new Headers(init.headers).get('content-type')||'application/octet-stream';
            const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','font/woff':'woff','font/woff2':'woff2','font/ttf':'ttf','font/otf':'otf'})[type];
            if(!extension||!/^[a-f0-9]{32}$/.test(receipt.id))throw new Error('Native uploaded resource identity changed');
            const bytes=new Uint8Array(await new Response(init.body).arrayBuffer()),name='project/assets/'+receipt.id+'.'+extension,url=renderResource(bytes,type);files.set(name,bytes);resources.set(name,url);resources.set('_blob/'+receipt.id,url);
          }
        }
        return new Response(result.body,{status:result.status,headers:{'content-type':result.mime}});
      };
      const script=path=>{
        if(!active||!/^artifact-type\/[a-z0-9.-]+\.js$/.test(path)||!files.has(path))throw new Error('The fixed native runtime is unavailable');
        return new TextDecoder().decode(files.get(path));
      };
      Object.defineProperty(window,'__bottegaNativeTransport',{value:Object.freeze({base,fetch:nativeFetch,resource,script})});
      const index=files.get('index.html');if(!index)throw new Error('Native editor entry is missing');
      const parsed=new DOMParser().parseFromString(new TextDecoder().decode(index),'text/html'),entry=parsed.querySelector('script[type=module][src]')?.getAttribute('src');
      const path=entry?new URL(entry,'https://native.invalid/').pathname.slice(1):'';if(!files.has(path))throw new Error('Native entry module is missing');
      document.body.replaceWith(parsed.body);for(const meta of parsed.head.querySelectorAll('meta'))document.head.append(meta);
      const marker=document.createElement('meta');marker.name='bottega-native-token';marker.content=token;document.head.append(marker);
      const imports={};for(const[name,bytes]of files)if(name.endsWith('.js')&&!name.startsWith('project/')){
        const code=new TextDecoder().decode(bytes).replace(/(\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])(\.\.?\/[^"']+)\2/g,(all,prefix,quote,relative)=>{
          const target=new URL(relative,'https://native.invalid/'+name).pathname.slice(1);return files.has(target)?prefix+JSON.stringify('bottega-native:'+target):all});
        imports['bottega-native:'+name]=create(code,'text/javascript');
      }
      const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);
      for(const[name,bytes]of files)if(name.endsWith('.css')&&!name.startsWith('project/')){
        const style=document.createElement('style');style.textContent=new TextDecoder().decode(bytes).replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g,(all,quote,relative)=>{
          if(relative.startsWith('data:'))return all;const target=new URL(relative,'https://native.invalid/'+name).pathname.slice(1);const url=resource(target);if(!url)throw new Error('Native CSS resource is missing');return 'url('+JSON.stringify(url)+')'});document.head.append(style);
      }
      const module=document.createElement('script');module.type='module';module.textContent='import '+JSON.stringify('bottega-native:'+path);document.head.append(module);
    };
    const connect=event=>{if(!event.isTrusted||event.source!==parent||event.origin!==parentOrigin||event.data?.type!=='bottega:native:remote-port'||event.data.token!==token||!event.ports[0]||port)return;
      port=event.ports[0];port.onmessage=event=>{const value=event.data;if(value?.type==='close'){close();return}if(value?.type==='initialize'){void initialize(value).catch(fail);return}const work=pending.get(value?.id);if(!work)return;pending.delete(value.id);value.error?work.reject(new Error(value.error)):work.resolve(value);pump()};port.start();
    };
    addEventListener('message',connect);const timer=setInterval(()=>{if(port){clearInterval(timer);return}parent.postMessage({type:'bottega:native:remote-connect',token},parentOrigin)},100);
    const timeout=setTimeout(()=>{clearInterval(timer);if(!port)fail(new Error('Native remote frame did not connect'))},15000);
    const close=()=>{if(!active)return;active=false;clearInterval(timer);clearTimeout(timeout);port?.close();for(const work of pending.values())work.reject(new Error('Native remote view closed'));pending.clear();for(const work of queued)work.reject(new Error('Native remote view closed'));queued.length=0;files.clear();cleanupResources();for(const url of urls)URL.revokeObjectURL(url);urls.length=0;removeEventListener('message',connect)};
    addEventListener('pagehide',close,{once:true});
  })()`;
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; style-src \'unsafe-inline\' blob:; img-src data: blob:; font-src data: blob:; connect-src blob:; frame-src blob: data:; worker-src blob:; media-src data: blob:"></head><body><script>' + source.replaceAll('</script', '<\\/script') + '</script></body></html>';
}
