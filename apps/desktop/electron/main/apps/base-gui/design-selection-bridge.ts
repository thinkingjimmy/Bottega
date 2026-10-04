/**
 * [INPUT]: Depends on nothing outside the browser it is injected into: DOM events, getComputedStyle, and postMessage
 * [OUTPUT]: Provides DESIGN_SELECTION_BRIDGE — the inline script the legacy Design preview injects to report element/region selections and pin overlays
 * [POS]: Browser-side leaf of the Design preview; workspace-preview.ts owns the HTTP boundary that serves it
 */

/* 预览文档的 sandbox 故意不带 allow-same-origin，所以它的源是不透明的：
   `location.origin` 是字符串 "null"，不是合法的 postMessage 目标源。桥只能
   用 "*" 投递；安全边界在受信外壳那一侧——它只接受来自当前 iframe 的消息，
   并且要求整条 schema 校验通过。 */
export const DESIGN_SELECTION_BRIDGE = `<script>(()=>{
  let mode="browse",start=null,hover=null,selected=null,pins=[];
  const overlays={};
  const clamp=(value,max)=>String(value||"").trim().slice(0,max);
  const integer=value=>Math.round(Number(value)||0);
  const rectOf=node=>{const r=node.getBoundingClientRect();return{
    x:integer(r.x),y:integer(r.y),width:integer(r.width),height:integer(r.height)
  }};
  const documentRect=rect=>({
    x:rect.x+integer(scrollX),y:rect.y+integer(scrollY),width:rect.width,height:rect.height
  });
  const escapeCss=value=>globalThis.CSS&&CSS.escape?CSS.escape(value):String(value).replace(/[^a-zA-Z0-9_-]/g,char=>"\\\\"+char);
  const queryCount=selector=>{try{return document.querySelectorAll(selector).length}catch{return 0}};
  const selectorFor=node=>{
    if(node.id){const selector="#"+escapeCss(node.id);if(queryCount(selector)===1)return selector}
    const parts=[];let current=node;
    while(current&&current instanceof Element&&parts.length<8){
      let part=current.tagName.toLowerCase();
      const classes=Array.from(current.classList).slice(0,4).map(value=>"."+escapeCss(value)).join("");
      if(classes)part+=classes;
      if(current.parentElement){
        const peers=Array.from(current.parentElement.children).filter(candidate=>candidate.tagName===current.tagName);
        if(peers.length>1)part+=":nth-of-type("+(peers.indexOf(current)+1)+")";
      }
      parts.unshift(part);const selector=parts.join(" > ");
      if(queryCount(selector)===1)return selector;
      current=current.parentElement;
    }
    return parts.join(" > ");
  };
  const ancestorsOf=node=>{
    const ancestors=[];let current=node.parentElement;
    while(current&&ancestors.length<8){
      ancestors.push({tag:current.tagName.toLowerCase(),id:clamp(current.id,120)||null,
        classes:Array.from(current.classList).slice(0,4).map(value=>clamp(value,120))});
      current=current.parentElement;
    }
    return ancestors;
  };
  const escapeAttr=value=>String(value).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const openingTag=node=>{
    const full=(node.outerHTML.match(/^<[^>]+>/)||[""])[0];if(full.length<=180)return full;
    const tag=node.tagName.toLowerCase(),id=escapeAttr(clamp(node.id,120));
    if(id){const identified="<"+tag+' id="'+id+'">';if(identified.length<=180)return identified}
    const classes=[];
    for(const value of Array.from(node.classList).slice(0,4)){
      const next=classes.concat(escapeAttr(value)),candidate="<"+tag+' class="'+next.join(" ")+'">';
      if(candidate.length>180)break;classes.push(escapeAttr(value));
    }
    return classes.length?"<"+tag+' class="'+classes.join(" ")+'">':"<"+tag+">";
  };
  const computedStyleOf=node=>{
    const style=getComputedStyle(node);return{
      color:clamp(style.color,120),backgroundColor:clamp(style.backgroundColor,120),
      fontSize:clamp(style.fontSize,120),fontWeight:clamp(style.fontWeight,120),
      lineHeight:clamp(style.lineHeight,120),textAlign:clamp(style.textAlign,120),
      fontFamily:clamp(style.fontFamily,120),paddingTop:clamp(style.paddingTop,120),
      paddingRight:clamp(style.paddingRight,120),paddingBottom:clamp(style.paddingBottom,120),
      paddingLeft:clamp(style.paddingLeft,120),borderRadius:clamp(style.borderRadius,120)
    }
  };
  const clickableFor=node=>node.closest&&node.closest("a,button,input,select,textarea,[role=button],[role=link]");
  const clickedDescendant=(selectedNode,clicked)=>selectedNode!==clicked?{
    label:clamp(clicked.getAttribute("aria-label")||clicked.getAttribute("title")||clicked.getAttribute("alt")||"",80),
    text:clamp(clicked.textContent||clicked.value||"",80)
  }:null;
  const sendElement=clicked=>{
    if(!(clicked instanceof Element))return;
    const node=clickableFor(clicked)||clicked;
    const rect=rectOf(node);selected=documentRect(rect);renderBox("selected",selected,"#ff5a36");
    parent.postMessage({channel:"ai-chat:design-selection",selection:{
      kind:"element",selector:clamp(selectorFor(node),512),tagName:node.tagName.toLowerCase(),
      id:clamp(node.id,120)||null,classes:Array.from(node.classList).slice(0,16).map(value=>clamp(value,120)),
      text:clamp(node.textContent||"",240),htmlHint:openingTag(node),computedStyle:computedStyleOf(node),
      ancestors:ancestorsOf(node),rect,clickedDescendant:clickedDescendant(node,clicked)
    }},"*");
  };
  const ensureLayer=()=>{
    if(overlays.layer||!document.body)return;
    const layer=document.createElement("div");layer.dataset.designOverlay="true";
    Object.assign(layer.style,{position:"absolute",left:"0",top:"0",width:"0",height:"0",zIndex:"2147483647",pointerEvents:"none"});
    document.body.appendChild(layer);overlays.layer=layer;
  };
  const renderBox=(name,rect,color,dashed=false)=>{
    ensureLayer();if(!overlays.layer)return;
    let box=overlays[name];
    if(!box){box=document.createElement("div");overlays.layer.appendChild(box);overlays[name]=box}
    if(!rect){box.style.display="none";return}
    Object.assign(box.style,{display:"block",position:"absolute",left:rect.x+"px",top:rect.y+"px",
      width:Math.max(0,rect.width)+"px",height:Math.max(0,rect.height)+"px",boxSizing:"border-box",
      border:"2px "+(dashed?"dashed ":"solid ")+color,background:dashed?"rgba(255,90,54,.08)":"transparent"});
  };
  const renderPins=()=>{
    ensureLayer();if(!overlays.layer)return;
    Array.from(overlays.layer.querySelectorAll("[data-design-pin]")).forEach(node=>node.remove());
    pins.forEach(pin=>{
      let rect=null,stale=Boolean(pin.stale);
      if(!stale&&pin.selector){try{const node=document.querySelector(pin.selector);if(node)rect=documentRect(rectOf(node));else stale=true}catch{stale=true}}
      else if(!stale&&pin.position)rect=pin.position;
      parent.postMessage({channel:"ai-chat:design-pin-status",pinId:pin.id,stale},"*");
      if(stale||!rect)return;
      const badge=document.createElement("div");badge.dataset.designPin=String(pin.id);badge.textContent=String(pin.id);
      Object.assign(badge.style,{position:"absolute",left:(rect.x-11)+"px",top:(rect.y-11)+"px",width:"22px",height:"22px",
        borderRadius:"50%",background:"#ff5a36",color:"white",font:"700 12px/22px sans-serif",textAlign:"center",
        boxShadow:"0 1px 4px rgba(0,0,0,.32)"});overlays.layer.appendChild(badge);
    });
  };
  const setMode=value=>{mode=value;start=null;hover=null;renderBox("hover",null,"#4a88ff");renderBox("rubber",null,"#ff5a36",true)};
  addEventListener("message",event=>{
    const data=event.data;
    if(event.source!==parent||!data)return;
    if(data.channel==="ai-chat:design-selection-mode"&&["browse","element","region"].includes(data.mode))setMode(data.mode);
    if(data.channel==="ai-chat:design-pins"&&Array.isArray(data.pins)){pins=data.pins.slice(0,64);renderPins()}
  });
  addEventListener("pointerover",event=>{
    if(mode!=="element"||!(event.target instanceof Element))return;
    const node=clickableFor(event.target)||event.target;hover=documentRect(rectOf(node));renderBox("hover",hover,"#4a88ff");
  },true);
  addEventListener("click",event=>{
    if(mode!=="element")return;
    event.preventDefault();event.stopPropagation();sendElement(event.target);
  },true);
  addEventListener("pointerdown",event=>{
    if(mode!=="region")return;
    event.preventDefault();event.stopPropagation();
    start={x:integer(event.clientX),y:integer(event.clientY),pointerId:event.pointerId};
  },true);
  addEventListener("pointermove",event=>{
    if(mode!=="region"||!start||event.pointerId!==start.pointerId)return;
    event.preventDefault();const x=Math.min(start.x,event.clientX),y=Math.min(start.y,event.clientY);
    renderBox("rubber",documentRect({x:integer(x),y:integer(y),width:integer(Math.abs(event.clientX-start.x)),height:integer(Math.abs(event.clientY-start.y))}),"#ff5a36",true);
  },true);
  addEventListener("pointerup",event=>{
    if(mode!=="region"||!start||event.pointerId!==start.pointerId)return;
    event.preventDefault();event.stopPropagation();
    const x=Math.min(start.x,event.clientX),y=Math.min(start.y,event.clientY);
    const rect={x:integer(x),y:integer(y),width:integer(Math.abs(event.clientX-start.x)),height:integer(Math.abs(event.clientY-start.y))};
    start=null;renderBox("rubber",null,"#ff5a36",true);selected=documentRect(rect);renderBox("selected",selected,"#ff5a36");
    parent.postMessage({channel:"ai-chat:design-selection",selection:{kind:"region",rect:documentRect(rect)}},"*");
  },true);
  addEventListener("scroll",()=>{if(hover)renderBox("hover",hover,"#4a88ff");if(selected)renderBox("selected",selected,"#ff5a36");renderPins()},{passive:true});
  if(document.readyState==="loading")addEventListener("DOMContentLoaded",()=>{ensureLayer();renderPins()},{once:true});else{ensureLayer();renderPins()}
})();</script>`;
