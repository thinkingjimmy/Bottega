/**
 * [INPUT]: Main-selected native mount selector and per-render nonce.
 * [OUTPUT]: nativePaintScript observes actual DOM commit, loaded fonts/output images and two paint frames, with viewport/flow lazy-image scope inside the opaque child.
 * [POS]: Controlled screenshot readiness; messages bind only the original WindowProxy and never grant write authority.
 */
export function nativePaintScript(selector: string | undefined, nonce: string, allImages = false) {
  const input = JSON.stringify({ selector, nonce, allImages });
  return "<script>(()=>{document.currentScript?.remove();const input=" + input + ";let pending=false,done=false;" +
    "const post=parent.postMessage.bind(parent);const finish=error=>{if(done)return;done=true;observer.disconnect();document.documentElement.setAttribute('data-bottega-render-paint',JSON.stringify({nonce:input.nonce,error}));post({type:'bottega:render:mounted',nonce:input.nonce,error},'*')};" +
    "const needed=()=>Array.from(document.images).filter(image=>{if(!image.currentSrc&&!image.getAttribute('src'))return false;if(input.allImages){image.loading='eager';return true}if(image.loading!=='lazy')return true;const rect=image.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth});" +
    "const check=()=>{const error=document.documentElement.getAttribute('data-bottega-render-error');if(error&&!done)return finish(error.slice(0,500));if(done||pending||document.readyState!=='complete'||input.selector&&!document.querySelector(input.selector))return;" +
    "void document.documentElement.offsetHeight;pending=true;const images=needed();" +
    "Promise.all([document.fonts.ready,...images.map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',()=>resolve(),{once:true});image.addEventListener('error',()=>resolve(),{once:true})}))])" +
    ".then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))).then(()=>{pending=false;" +
    "if(document.fonts.status!=='loaded'||needed().some(image=>!image.complete))return check();" +
    "if(Array.from(document.fonts).some(face=>face.status==='error')||images.some(image=>image.complete&&!image.naturalWidth))return finish('Native font or image failed to load');finish(null)" +
    "}).catch(()=>finish('Native document did not finish loading'))};" +
    "const observer=new MutationObserver(check);observer.observe(document,{subtree:true,childList:true,attributes:true});" +
    "addEventListener('DOMContentLoaded',check,{once:true});addEventListener('load',check,{once:true});check()})()</script>";
}
