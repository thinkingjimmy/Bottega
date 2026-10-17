/**
 * [INPUT]: Prepared board HTML, owner-issued frame identity and transient UI edit sessions.
 * [OUTPUT]: Opaque preview with trusted editor wheel panning, native Preview scrolling, session-owned text and authenticated display metadata.
 * [POS]: Canvas frame interaction bridge; source authority and shared schemas remain with the owner service.
 */
import { DESIGN_PROPERTIES } from "./canvas/model";
export const DESIGN_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src data: blob:; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
export type DesignFrameIdentity = { id: string; nonce: string; selectionNonce: string; generation: string; boardId: string; boardDigest: string; navigation?: Record<string, string> };
export function designFrameHtml(html: string, identity: DesignFrameIdentity) {
  const seed = JSON.stringify(identity).replace(/</g, "\\u003c");
  const script = `(()=>{
    const identity=${seed};document.currentScript?.remove();const send=parent.postMessage.bind(parent);
    const cssKeys=${JSON.stringify(DESIGN_PROPERTIES.filter(property=>property!=='text'))};
    const hintKeys=[...new Set([...cssKeys,'font-family','font-weight','font-style','text-decoration','text-align','line-height','letter-spacing','position','left','top','border-radius','box-sizing'])];
    let tool='preview',selecting=false,regionMode=false,start=null,overlay=null,touch=null,blockClick=false,targets=[],selected=null,lastGeometry=0,lastHover=0,lastReselect='',lastFocus=0,pan=null,space=false,shadow=null,editor=null,editorSession=-1,wheelEnd;
    const stamp=type=>({type,id:identity.id,nonce:identity.nonce,generation:identity.generation,boardId:identity.boardId,boardDigest:identity.boardDigest});
    const viewport=()=>({width:Math.max(40,Math.min(8000,innerWidth)),height:Math.max(40,Math.min(8000,innerHeight)),scrollX:Math.max(0,Math.min(1000000,scrollX)),scrollY:Math.max(0,Math.min(1000000,scrollY))});
    const point=event=>({x:Math.max(0,Math.min(innerWidth,event.clientX)),y:Math.max(0,Math.min(innerHeight,event.clientY))});
    const nativeTarget=target=>{
      for(let el=target instanceof Element?target:null;el&&el!==document.documentElement;el=el.parentElement){
        if(el.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return true;
        const style=getComputedStyle(el);if((/auto|scroll/.test(style.overflowY)&&el.scrollHeight>el.clientHeight)||(/auto|scroll/.test(style.overflowX)&&el.scrollWidth>el.clientWidth))return true;
      }return false;
    };
    const typing=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
    const box=el=>{const r=el.getBoundingClientRect(),x=Math.max(0,r.left),y=Math.max(0,r.top),w=Math.min(innerWidth,r.right)-x,h=Math.min(innerHeight,r.bottom)-y;return w>0&&h>0?{x:x/innerWidth,y:y/innerHeight,width:w/innerWidth,height:h/innerHeight}:null;};
    const resolve=target=>{try{const nodes=document.querySelectorAll(target.selector);return nodes.length===1&&(nodes[0].textContent||'').trim().slice(0,2048)===target.currentText?nodes[0]:null;}catch{return null;}};
    const stopEditor=()=>{editor?.input.remove();editor=null;};
    const restore=()=>{stopEditor();if(!shadow)return;const {el,text,styles}=shadow;if(el.isConnected){if(text!==undefined)el.textContent=text;for(const [key,value,priority]of styles)el.style.setProperty(key,value,priority);}shadow=null;};
    const clean=()=>{overlay?.remove();overlay=null;start=null;touch=null;if(pan){pan=null;send({...stamp('bottega:design:gesture'),kind:'pan',phase:'end',x:0,y:0,dx:0,dy:0},'*');}};
    const targetBox=target=>{
      if(target.selector){const el=shadow&&shadow.target.selector===target.selector?shadow.el:resolve(target);return el?box(el):null;}
      if(!target.region||!target.viewport)return null;const r=target.region,v=target.viewport,x=Math.max(0,r.x*v.width+v.scrollX-scrollX),y=Math.max(0,r.y*v.height+v.scrollY-scrollY),w=Math.min(innerWidth,r.x*v.width+v.scrollX-scrollX+r.width*v.width)-x,h=Math.min(innerHeight,r.y*v.height+v.scrollY-scrollY+r.height*v.height)-y;
      return w>0&&h>0?{x:x/innerWidth,y:y/innerHeight,width:w/innerWidth,height:h/innerHeight}:null;
    };
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const positionEditor=()=>{if(!editor||!editor.el.isConnected)return;const r=editor.el.getBoundingClientRect();Object.assign(editor.input.style,{left:r.left+'px',top:r.top+'px',width:Math.max(44,r.width)+'px',height:Math.max(44,r.height)+'px'});};
    const geometry=()=>{positionEditor();if(Date.now()-lastGeometry<40)return;lastGeometry=Date.now();send({...stamp('bottega:design:geometry'),targets:targets.map(target=>({id:target.id,bounds:targetBox(target)})),selected:selected?targetBox(selected):null,selectedRect:selected?.selector?rect(shadow?.el??resolve(selected)):null},'*');};
    const anchorFor=el=>{
      el=el?.closest('[data-bottega-object]')??el;if(!el||!el.isConnected||el===overlay)return null;let selector=null;
      if(el.id&&document.querySelectorAll('#'+CSS.escape(el.id)).length===1)selector='#'+CSS.escape(el.id);
      else{const parts=[];let node=el;for(let i=0;node&&i<12;i++,node=node.parentElement){const same=node.parentElement?[...node.parentElement.children].filter(item=>item.localName===node.localName):[];parts.unshift(node.localName+(same.length>1?':nth-of-type('+(same.indexOf(node)+1)+')':''));}selector=parts.join(' > ');}
      const bounds=box(el),style=getComputedStyle(el),properties=Object.fromEntries(cssKeys.map(key=>[key,style.getPropertyValue(key).slice(0,128)]));
      return {rect:rect(el),anchor:{boardId:identity.boardId,boardDigest:identity.boardDigest,selector,currentText:(el.textContent||'').trim().slice(0,2048),region:null,viewport:viewport(),...(bounds?{bounds}:{}),properties},hints:Object.fromEntries(hintKeys.map(key=>[key,style.getPropertyValue(key).slice(0,128)]))};
    };
    const pick=(el,event,intent='select')=>{const result=anchorFor(el);if(result)send({...stamp('bottega:design:anchor'),...result,extend:event?.shiftKey===true,intent},'*');};
    const gesture=(kind,phase,event,dx=0,dy=0)=>{const p=point(event);send({...stamp('bottega:design:gesture'),kind,phase,x:p.x/innerWidth,y:p.y/innerHeight,dx:Math.max(-10000,Math.min(10000,dx)),dy:Math.max(-10000,Math.min(10000,dy))},'*');};
    for(const key of ['RTCPeerConnection','webkitRTCPeerConnection','Worker','SharedWorker']){try{Object.defineProperty(window,key,{value:undefined,writable:false,configurable:false});}catch{}}
    window.open=()=>null;
    addEventListener('message',event=>{
      if(!event.isTrusted||event.source!==parent||event.data?.nonce!==identity.selectionNonce)return;const data=event.data;
      if(data.type==='bottega:design:select'){const enabled=data.enabled===true,nextTool=enabled?'select':'preview',region=data.mode==='region',changed=selecting!==enabled||tool!==nextTool||regionMode!==region;selecting=enabled;tool=nextTool;regionMode=region;document.documentElement.style.touchAction=selecting?'none':'';clean();if(changed)restore();}
      if(data.type==='bottega:design:tool'&&['preview','select','annotate','hand','text'].includes(data.tool)){const enabled=['select','annotate','text'].includes(data.tool),region=data.mode==='region',changed=tool!==data.tool||selecting!==enabled||regionMode!==region;tool=data.tool;selecting=enabled;regionMode=region;document.documentElement.style.touchAction=selecting?'none':'';clean();if(changed)restore();}
      if(data.type==='bottega:design:targets'){
        targets=Array.isArray(data.targets)?data.targets.slice(0,32):[];selected=data.selected||null;const target=targets.find(target=>target.id===data.locate);
        if(target){const el=target.selector?resolve(target):null;if(el)el.scrollIntoView({block:'center',inline:'center'});else if(target.region&&target.viewport)scrollTo(target.region.x*target.viewport.width+target.viewport.scrollX,target.region.y*target.viewport.height+target.viewport.scrollY);}
        if(Number.isSafeInteger(data.focusSelection)&&data.focusSelection>lastFocus&&selected?.selector){lastFocus=data.focusSelection;const el=shadow?.el??resolve(selected);el?.scrollIntoView({block:'center',inline:'center'});}
        if(typeof data.reselect==='string'&&data.reselect.startsWith('#')&&data.reselect.length<=500&&data.reselect!==lastReselect){lastReselect=data.reselect;try{const nodes=document.querySelectorAll(data.reselect);if(nodes.length===1)pick(nodes[0],null);}catch{}}
        lastGeometry=0;geometry();
      }
      if(data.type==='bottega:design:editor'){
        const session=data.session;if(!Number.isSafeInteger(session)||session<0||session<editorSession)return;
        if(data.clear===true){restore();editorSession=session;return;}const target=data.target;if(!target||target.boardId!==identity.boardId||target.boardDigest!==identity.boardDigest||typeof data.value!=='string'||data.value.length>4096)return;
        const el=shadow?.target.selector===target.selector?shadow.el:resolve(target);if(!el)return;
        if(session>editorSession){restore();editorSession=session;}
        if(editor&&editor.target.selector!==target.selector)restore();
        if(!shadow)shadow={el,target,text:el.children.length?undefined:el.textContent,styles:hintKeys.concat('visibility').map(key=>[key,el.style.getPropertyValue(key),el.style.getPropertyPriority(key)])};el.style.visibility='hidden';
        if(!editor){
          const input=document.createElement('textarea'),style=getComputedStyle(el);input.setAttribute('aria-label',typeof data.label==='string'?data.label.slice(0,128):'Edit text');input.maxLength=4096;input.style.cssText='position:fixed;z-index:2147483647;box-sizing:border-box;margin:0;padding:0;border:0;outline:2px solid #2563eb;resize:none;overflow:auto;';
          for(const key of ['font-family','font-size','font-weight','font-style','text-decoration','text-align','line-height','letter-spacing','color','background-color'])input.style.setProperty(key,style.getPropertyValue(key),'important');
          // Native text and selection belong to this session; host draft echoes are metadata only.
          input.value=data.value;editor={input,el,target};document.documentElement.append(input);
          const emit=phase=>send({...stamp('bottega:design:text'),session,selector:target.selector,value:input.value.slice(0,4096),phase},'*');
          input.addEventListener('input',event=>{if(event.isTrusted&&editor?.input===input)emit('input');});
          input.addEventListener('keydown',event=>{if(!event.isTrusted||event.isComposing)return;if(event.key==='Escape'||event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopImmediatePropagation();emit(event.key==='Escape'?'cancel':'done');}},true);
        }
        editor.input.readOnly=data.readOnly===true;
        if(data.styles&&typeof data.styles==='object')for(const key of hintKeys)if(typeof data.styles[key]==='string'&&data.styles[key].length<=256)editor.input.style.setProperty(key,data.styles[key],'important');
        positionEditor();if(data.focus===true&&!editor.focused){editor.focused=true;editor.input.focus();editor.input.setSelectionRange(editor.input.value.length,editor.input.value.length);}
      }
      if(data.type==='bottega:design:display'){
        if(data.clear===true){restore();lastGeometry=0;geometry();return;}
        const target=data.target;if(!target||target.boardId!==identity.boardId||target.boardDigest!==identity.boardDigest||typeof target.selector!=='string')return;
        if(shadow&&shadow.target.selector!==target.selector)restore();
        const el=shadow?.el??resolve(target);if(!el)return;
        if(!shadow)shadow={el,target,text:el.children.length?undefined:el.textContent,styles:hintKeys.concat('visibility').map(key=>[key,el.style.getPropertyValue(key),el.style.getPropertyPriority(key)])};
        if(data.hide===true)el.style.visibility='hidden';else el.style.setProperty('visibility',shadow.styles.find(item=>item[0]==='visibility')[1]);
        if(!el.children.length&&typeof data.text==='string'&&data.text.length<=4096)el.textContent=data.text;
        if(data.styles&&typeof data.styles==='object')for(const key of hintKeys)if(typeof data.styles[key]==='string'&&data.styles[key].length<=256)el.style.setProperty(key,data.styles[key]);
        lastGeometry=0;geometry();
      }
    });
    addEventListener('scroll',geometry,true);addEventListener('resize',()=>{lastGeometry=0;geometry();});
    addEventListener('keydown',event=>{
      if(!event.isTrusted)return;if(editor?.input===event.target)return;if(tool==='preview'&&typing(event.target))return;if(event.key==='Escape'){clean();restore();selecting=false;space=false;send(stamp('bottega:design:escape'),'*');return;}
      if(typing(event.target)||tool==='preview')return;
      if(event.key===' '){space=true;event.preventDefault();return;}
      const key=event.key.toLowerCase(),command=event.metaKey||event.ctrlKey;
      if((command&&['z','d','+','=','-','0'].includes(key))||(!command&&!event.altKey&&['v','h','t','a','n','p','r','o','l','delete','backspace','arrowleft','arrowright','arrowup','arrowdown'].includes(key))){event.preventDefault();event.stopImmediatePropagation();send({...stamp('bottega:design:key'),key,shift:event.shiftKey,meta:event.metaKey,ctrl:event.ctrlKey,alt:event.altKey,repeat:event.repeat},'*');}
    },true);
    addEventListener('keyup',event=>{if(event.isTrusted&&event.key===' ')space=false;},true);
    addEventListener('blur',()=>{space=false;clean();});
    addEventListener('touchmove',event=>{if(event.isTrusted&&(tool==='hand'||space)&&!nativeTarget(event.target)&&event.cancelable)event.preventDefault();},{capture:true,passive:false});
    addEventListener('wheel',event=>{
      if(!event.isTrusted||typing(event.target)||nativeTarget(event.target))return;
      if(!event.ctrlKey&&!event.metaKey&&tool==='preview')return;event.preventDefault();event.stopImmediatePropagation();const unit=event.deltaMode===1?16:event.deltaMode===2?innerHeight:1;
      const kind=event.ctrlKey||event.metaKey?'zoom':'pan';gesture(kind,'change',event,(kind==='pan'?-1:1)*event.deltaX*unit,(kind==='pan'?-1:1)*event.deltaY*unit);clearTimeout(wheelEnd);wheelEnd=setTimeout(()=>gesture(kind,'end',event),180);
    },{capture:true,passive:false});
    addEventListener('pointerdown',event=>{
      if(!event.isTrusted)return;blockClick=false;
      if((tool==='hand'||space||event.button===1)&&!nativeTarget(event.target)){
        clean();event.preventDefault();event.stopImmediatePropagation();pan={id:event.pointerId,x:event.screenX,y:event.screenY};try{document.documentElement.setPointerCapture(event.pointerId);}catch{}return;
      }
      if(!selecting)return;clean();
      if(!regionMode){if(event.pointerType==='touch'&&event.target instanceof Element)touch={id:event.pointerId,el:event.target,from:point(event),moved:false};return;}
      event.preventDefault();event.stopImmediatePropagation();start=point(event);overlay=document.createElement('div');overlay.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #2563eb;background:#2563eb22;';document.documentElement.append(overlay);
    },true);
    addEventListener('pointermove',event=>{
      if(!event.isTrusted)return;const end=point(event);
      if(pan&&pan.id===event.pointerId){event.preventDefault();event.stopImmediatePropagation();gesture('pan','change',event,event.screenX-pan.x,event.screenY-pan.y);pan.x=event.screenX;pan.y=event.screenY;return;}
      if(touch&&touch.id===event.pointerId){if(Math.abs(end.x-touch.from.x)>8||Math.abs(end.y-touch.from.y)>8)touch.moved=true;return;}
      if(start&&overlay){event.preventDefault();event.stopImmediatePropagation();Object.assign(overlay.style,{left:Math.min(start.x,end.x)+'px',top:Math.min(start.y,end.y)+'px',width:Math.abs(end.x-start.x)+'px',height:Math.abs(end.y-start.y)+'px'});return;}
      if(selecting&&!regionMode&&Date.now()-lastHover>50){lastHover=Date.now();send({...stamp('bottega:design:hover'),bounds:event.target instanceof Element?box(event.target):null},'*');}
    },true);
    addEventListener('pointerup',event=>{
      if(!event.isTrusted)return;
      if(pan&&pan.id===event.pointerId){event.preventDefault();event.stopImmediatePropagation();pan=null;blockClick=true;gesture('pan','end',event);return;}
      if(selecting&&!regionMode&&touch&&touch.id===event.pointerId){const target=touch;touch=null;blockClick=true;event.preventDefault();event.stopImmediatePropagation();if(!target.moved&&event.target instanceof Element&&(event.target===target.el||target.el.contains(event.target)))pick(target.el,event,tool==='text'?'edit-text':'select');return;}
      if(!start)return;event.preventDefault();event.stopImmediatePropagation();blockClick=true;const end=point(event),from=start;clean();if(Math.abs(end.x-from.x)<4||Math.abs(end.y-from.y)<4)return;
      send({...stamp('bottega:design:anchor'),anchor:{boardId:identity.boardId,boardDigest:identity.boardDigest,selector:null,currentText:'',viewport:viewport(),region:{x:Math.min(from.x,end.x)/innerWidth,y:Math.min(from.y,end.y)/innerHeight,width:Math.abs(end.x-from.x)/innerWidth,height:Math.abs(end.y-from.y)/innerHeight}},intent:'select',extend:false},'*');
    },true);
    addEventListener('pointercancel',event=>{if(!event.isTrusted)return;if(touch||start||pan)blockClick=true;clean();},true);
    addEventListener('click',event=>{
      if(!event.isTrusted)return;if(blockClick&&event.detail>0){blockClick=false;event.preventDefault();event.stopImmediatePropagation();return;}
      if(!selecting)return;event.preventDefault();event.stopImmediatePropagation();if(!regionMode)pick(event.target instanceof Element?event.target:null,event,tool==='text'?'edit-text':'select');
    },true);
    addEventListener('dblclick',event=>{if(!event.isTrusted||!selecting||regionMode)return;event.preventDefault();event.stopImmediatePropagation();pick(event.target instanceof Element?event.target:null,event,'edit-text');},true);
    addEventListener('click',event=>{
      const link=event.target instanceof Element?event.target.closest('a,area'):null;if(!link)return;const href=link.getAttribute('href')||'';if(href.startsWith('#'))return;event.preventDefault();
      if(!event.isTrusted||tool!=='preview'||selecting||!identity.navigation||!Object.hasOwn(identity.navigation,href))return;send({...stamp('bottega:design:navigate'),boardId:identity.navigation[href]},'*');
    },true);
  })();`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${DESIGN_FRAME_CSP}"><script>${script}</script>` + html.replace(/<!doctype[^>]*>/i, "");
}
