/**
 * [INPUT]: Main-private font verifier nonce/binding and the original opaque preview evaluation capability.
 * [OUTPUT]: fontAuditBrowserScript installs bounded parent and actual Canvas capture font evidence hooks.
 * [POS]: Read-only output probe; authored children receive only an audit marker, never the main binding nonce or parent capability.
 */
export function fontAuditBrowserScript(nonce: string, binding: string) {
  return String.raw`(()=>{
    const nonce=${JSON.stringify(nonce)},binding=${JSON.stringify(binding)},pending=new Map(),cache=new Map();
    const normalize=value=>value.trim().replace(/^["']|["']$/g,'').toLowerCase();
    const faces=async()=>{
      const declarations=[],loaded=Array.from(document.fonts);let count=0;
      const walk=rules=>{for(const rule of rules){if(++count>20000)throw new Error('FONT_EVIDENCE_BUDGET');
        if(rule.type===CSSRule.FONT_FACE_RULE)declarations.push(rule.style);else if(rule.cssRules)walk(rule.cssRules)}};
      for(const sheet of document.styleSheets){try{walk(sheet.cssRules)}catch(error){if(error.message==='FONT_EVIDENCE_BUDGET')throw error}}
      if(declarations.length>64)throw new Error('FONT_EVIDENCE_BUDGET');
      return Promise.all(declarations.map(async style=>{
        const family=style.fontFamily,weight=(style.fontWeight||'400').split(/\s+/).map(value=>value==='normal'?400:value==='bold'?700:Number(value));
        const match=/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(style.src),rawUrl=(match?.[1]??match?.[2]??match?.[3]??'').trim(),base=style.parentRule?.parentStyleSheet?.href||document.baseURI;
        let url=rawUrl;try{url=new URL(rawUrl,base).href}catch{}
        let digest;
        if(url.startsWith('data:')||url.startsWith('blob:')){
          let promise=cache.get(url);if(!promise){promise=(async()=>{let bytes;if(url.startsWith('blob:')){const response=await fetch(url);if(!response.ok)throw new Error('FONT_BYTES_UNVERIFIED');const blob=await response.blob();if(blob.size>24*1024*1024)throw new Error('FONT_BYTES_UNVERIFIED');bytes=new Uint8Array(await blob.arrayBuffer())}
            else{const match=/^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/.exec(url);if(!match||match[1].length>32*1024*1024)throw new Error('FONT_BYTES_UNVERIFIED');bytes=Uint8Array.from(atob(match[1]),char=>char.charCodeAt(0))}
            return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('')})();cache.set(url,promise)}digest=await promise;
        }
        return {family,digest,...(digest?{}:{url,base:String(base).slice(0,180),rawUrl:rawUrl.slice(0,160)}),style:style.fontStyle||'normal',weight:[weight[0],weight[1]??weight[0]],loaded:loaded.some(face=>normalize(face.family)===normalize(family)&&face.status==='loaded')};
      }));
    };
    const request=(id,faces)=>new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{window[binding](JSON.stringify({nonce,id,faces}))}catch(error){pending.delete(id);reject(error)}});
    Object.defineProperty(window,'__bottegaNativeFontReply',{value:(id,error)=>{const work=pending.get(id);if(!work)return;pending.delete(id);error?work.reject(new Error(error)):work.resolve()}});
    Object.defineProperty(window,'__bottegaNativeFontAudit',{value:async root=>{
      if(!(root instanceof Element)||root.ownerDocument!==document)throw new Error('The output font root belongs to another document');
      const id=crypto.randomUUID();root.setAttribute('data-bottega-font-audit',id);
      try{await request(id,await faces())}finally{root.removeAttribute('data-bottega-font-audit')}
    }});
    Object.defineProperty(window,'__bottegaNativeCanvasFontAudit',{value:async preview=>{
      const id=crypto.randomUUID(),marker=JSON.stringify(id);
      const collect='(async()=>{const cache=new Map(),normalize=('+normalize.toString()+');document.body.setAttribute("data-bottega-font-audit",'+marker+');await document.fonts.ready;return ('+faces.toString()+')()})()';
      try{await request(id,await preview.executeJavaScript(collect,15000))}
      finally{await preview.executeJavaScript('document.body.removeAttribute("data-bottega-font-audit");null',2000).catch(()=>{})}
    }});
  })()`;
}
