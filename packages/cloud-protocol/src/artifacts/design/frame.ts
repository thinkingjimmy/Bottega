/**
 * [INPUT]: Prepared immutable system board HTML, owner-issued frame identity and main-verified native-runtime permission and the closed fixed-view schema.
 * [OUTPUT]: Read-only opaque preview with authenticated readiness, fixed local navigation and explicit runtime CSP and a bounded, writer-free encrypted HTML payload.
 * [POS]: System preview bridge; no parent message grants editing or source mutation.
 */
import { z } from "zod";
import { designFrameViewSchema } from "./model";
export const designPreviewPayloadSchema = z.object({
  html: z.string().max(50_000_000).refine(value => new TextEncoder().encode(value).byteLength <= 50_000_000, "Fixed preview exceeds its byte budget"),
  identity: designFrameViewSchema.refine(value => Object.keys(value.navigation ?? {}).length <= 256, "Fixed navigation exceeds its board budget"),
}).strict();
export type DesignPreviewPayload = z.infer<typeof designPreviewPayloadSchema>;
export const DESIGN_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src data: blob:; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
export function designFramePolicy(nativeRuntime = false) {
  return nativeRuntime ? DESIGN_FRAME_CSP.replace("script-src ", "script-src 'unsafe-eval' ") : DESIGN_FRAME_CSP;
}
export type DesignFrameIdentity = { id: string; nonce: string; generation: string; boardId: string; boardDigest: string; navigation?: Record<string, string> };
export function designFrameHtml(html: string, identity: DesignFrameIdentity, nativeRuntime = false) {
  const seed = JSON.stringify(identity).replace(/</g, "\\u003c");
  const script = `(()=>{
    const identity=${seed};document.currentScript?.remove();const send=parent.postMessage.bind(parent);
    const stamp=type=>({type,id:identity.id,nonce:identity.nonce,generation:identity.generation,boardId:identity.boardId,boardDigest:identity.boardDigest});
    const ready=()=>send({...stamp('bottega:design:geometry'),targets:[],selected:null},'*');
    addEventListener('DOMContentLoaded',ready,{once:true});addEventListener('load',ready,{once:true});
    document.fonts?.ready.then(ready).catch(()=>{});
    addEventListener('click',event=>{
      const link=event.target instanceof Element?event.target.closest('a,area'):null;if(!link)return;
      const href=link.getAttribute('href')||'';if(href.startsWith('#'))return;event.preventDefault();
      if(event.isTrusted&&identity.navigation&&Object.hasOwn(identity.navigation,href))send({...stamp('bottega:design:navigate'),targetBoardId:identity.navigation[href]},'*');
    },true);
  })();`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${designFramePolicy(nativeRuntime)}"><script>${script}</script>` + html.replace(/<!doctype[^>]*>/i, "");
}
