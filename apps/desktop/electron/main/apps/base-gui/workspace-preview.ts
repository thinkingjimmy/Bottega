/**
 * [INPUT]: Depends on Base GUI surface binding/token claims, Node HTTP streams, and a custody-aware Design workspace port
 * [OUTPUT]: Provides legacy authenticated workspace path routes and delegates compiled-v3 opaque refs/previews to the isolated compiled facade
 * [POS]: The Base GUI Design workspace-read composition boundary; legacy route parsing remains here while compiled trust-domain logic lives in compiled-workspace.ts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AppGuiRuntimeErrorCode,
  BaseGuiLiveBinding,
} from "../../../../shared/apps-ipc";
import type { GuiTokenClaims } from "../gui-api";
import { bearerToken, sameGuiBinding } from "./api/router";
import { CompiledWorkspaceFacade } from "./compiled-workspace";

const PREVIEW_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data:; frame-src 'self'; " +
  "frame-ancestors 'self' file: http://localhost:*; " +
  "base-uri 'none'; form-action 'none'; webrtc 'block'";

/* The preview document has an opaque origin because its sandbox intentionally omits
   allow-same-origin. `location.origin` is therefore "null", which is not a valid
   postMessage target origin. The bridge must use "*" for delivery; the trusted shell
   is the security boundary and accepts messages only from the active iframe source
   after validating the complete schema. */
const DESIGN_SELECTION_BRIDGE = `<script>(()=>{
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

type WorkspaceVersion = Readonly<{
  versionId: string;
  canonicalRelativePath: string;
  digest: string;
  source: "ai" | "manual" | "restore";
  parentVersion: string | null;
  restoredFromVersion?: string;
  provenance: Readonly<Record<string, string | undefined>>;
  createdAt: number;
}>;

export type WorkspacePreviewPort = Readonly<{
  list(binding: BaseGuiLiveBinding): Promise<{
    files: readonly string[];
    canvases?: readonly Readonly<{
      file: string;
      digest: string;
      advisories: readonly Readonly<{
        ruleId: string;
        message: string;
        count: number;
      }>[];
    }>[];
    revision: number;
    drafting?: boolean;
  }>;
  read(
    binding: BaseGuiLiveBinding,
    canonicalRelativePath: string
  ): Promise<Buffer | string | null>;
  listVersions(
    binding: BaseGuiLiveBinding,
    canonicalRelativePath: string
  ): Promise<readonly WorkspaceVersion[]>;
  readVersion(binding: BaseGuiLiveBinding, versionId: string): Promise<{
    version: WorkspaceVersion;
    content: Buffer | string;
  }>;
}>;

type TokenVerifier = Readonly<{
  verify(
    appId: string,
    surfaceId: string,
    candidate: string
  ): GuiTokenClaims | null;
}>;

export type WorkspacePreviewHandler = ((
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) => Promise<boolean>) & Readonly<{
  resolveOpaqueOrigin(appId: string, handle: string): BaseGuiLiveBinding | null;
  serveOpaqueOrigin(
    appId: string,
    handle: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void>;
}>;

export function createWorkspacePreviewHandler(
  tokens: TokenVerifier,
  port: WorkspacePreviewPort
): WorkspacePreviewHandler {
  const compiled = new CompiledWorkspaceFacade(port);
  const handler = async (context: Readonly<{
    appId: string;
    binding: BaseGuiLiveBinding;
  }>, pathname: string, request: IncomingMessage, response: ServerResponse) => {
    if (pathname.startsWith("/_api/workspace/")) {
      if (context.binding.contentLayoutVersion === 3) {
        const binding = authenticateWorkspace(tokens, context, request, response);
        if (binding) await compiled.api(context, pathname, request, response);
      } else {
        await workspaceApi(tokens, port, context, pathname, request, response);
      }
      return true;
    }
    if (!pathname.startsWith("/_preview/")) return false;
    if (context.binding.contentLayoutVersion === 3) {
      respond(response, 404, workspaceError("workspace_route_not_found", "Legacy preview is unavailable to compiled Apps"), "application/json");
      return true;
    }
    await previewWorkspaceFile(port, context, pathname, request, response);
    return true;
  };
  return Object.assign(handler, {
    resolveOpaqueOrigin: (appId: string, handle: string) =>
      compiled.resolveOpaqueOrigin(appId, handle),
    serveOpaqueOrigin: (
      appId: string,
      handle: string,
      request: IncomingMessage,
      response: ServerResponse
    ) => compiled.serveOpaqueOrigin(appId, handle, request, response),
  });
}

async function workspaceApi(
  tokens: TokenVerifier,
  port: WorkspacePreviewPort,
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) {
  const binding = authenticateWorkspace(tokens, context, request, response);
  if (!binding) return;
  if (pathname === "/_api/workspace/files") {
    await listWorkspaceFiles(port, binding, request, response);
    return;
  }
  if (pathname === "/_api/workspace/versions") {
    await listWorkspaceVersions(port, binding, request, response);
    return;
  }
  if (pathname === "/_api/workspace/source-line") {
    await resolveWorkspaceSourceLine(port, binding, request, response);
    return;
  }
  respond(response, 404, workspaceError("workspace_route_not_found", "Workspace route not found"), "application/json");
}

function authenticateWorkspace(
  tokens: TokenVerifier,
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  request: IncomingMessage,
  response: ServerResponse
) {
  const { binding } = context;
  const claims = tokens.verify(context.appId, binding.surfaceId, bearerToken(request));
  if (!claims || !sameGuiBinding(claims, binding)) {
    respond(response, 401, workspaceError("invalid_token", "Workspace token is invalid or expired"), "application/json");
    return null;
  }
  if (
    binding.workspaceReadScope !== "design/" ||
    !binding.baseCapabilities.includes("workspace-read")
  ) {
    /* workspace 路由的 403 只有一个名字：workspaceFailureCode(403) 已经把
       下游拒绝映射成 workspace_forbidden，入口这道闸再叫 capability_not_granted，
       同一个「你没有这条 workspace 权限」就按抛出层级分裂成两个 code。 */
    respond(response, 403, workspaceError("workspace_forbidden", "workspace-read capability is not granted"), "application/json");
    return null;
  }
  return binding;
}

async function listWorkspaceFiles(
  port: WorkspacePreviewPort,
  binding: BaseGuiLiveBinding,
  request: IncomingMessage,
  response: ServerResponse
) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    respond(response, 405, workspaceError("method_not_allowed", "Only GET and HEAD are supported"), "application/json");
    return;
  }
  let listing: Awaited<ReturnType<WorkspacePreviewPort["list"]>>;
  try {
    listing = await port.list(binding);
  } catch (cause) {
    const status = workspaceFailureStatus(cause);
    respond(
      response,
      status,
      workspaceError(workspaceFailureCode(status), workspaceFailureMessage(status)),
      "application/json",
      method === "HEAD"
    );
    return;
  }
  respond(
    response,
    200,
    {
      files: [...listing.files],
      canvases: [...(listing.canvases ?? [])],
      revision: listing.revision,
      drafting: listing.drafting === true,
    },
    "application/json",
    method === "HEAD"
  );
}

async function listWorkspaceVersions(
  port: WorkspacePreviewPort,
  binding: BaseGuiLiveBinding,
  request: IncomingMessage,
  response: ServerResponse
) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return methodNotAllowed(response, "GET, HEAD");
  await withWorkspaceJson(response, async () => {
    const url = new URL(request.url ?? "/", "http://workspace.local");
    const versions = await port.listVersions(binding, requireDesignFile(url.searchParams.get("file")));
    return { versions: versions.map(publicVersion) };
  }, method === "HEAD");
}

async function resolveWorkspaceSourceLine(
  port: WorkspacePreviewPort,
  binding: BaseGuiLiveBinding,
  request: IncomingMessage,
  response: ServerResponse
) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return methodNotAllowed(response, "GET, HEAD");
  await withWorkspaceJson(response, async () => {
    const url = new URL(request.url ?? "/", "http://workspace.local");
    const file = requireDesignFile(url.searchParams.get("file"));
    const hint = requireHtmlHint(url.searchParams.get("hint"));
    const content = await port.read(binding, file);
    if (content === null) throw Object.assign(new Error("Canvas not found"), { status: 404 });
    const source = Buffer.isBuffer(content) ? content.toString("utf8") : content;
    const matches = matchingOpeningTags(source, hint);
    const first = matches[0] ?? -1;
    const unique = matches.length === 1;
    return { sourceLine: unique ? source.slice(0, first).split("\n").length : null };
  }, method === "HEAD");
}

function matchingOpeningTags(source: string, hint: string) {
  const exact = source.indexOf(hint);
  if (exact >= 0) {
    return source.indexOf(hint, exact + hint.length) < 0 ? [exact] : [exact, exact];
  }
  const tag = /^<([a-z][a-z0-9:-]*)\b/i.exec(hint)?.[1];
  if (!tag) return [];
  const expectedId = htmlAttribute(hint, "id");
  const expectedClasses = (htmlAttribute(hint, "class") ?? "").split(/\s+/).filter(Boolean);
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^<>]*?)?>`, "gi");
  const matches: number[] = [];
  for (const candidate of source.matchAll(pattern)) {
    if (expectedId !== null && htmlAttribute(candidate[0], "id") !== expectedId) continue;
    const classes = new Set((htmlAttribute(candidate[0], "class") ?? "").split(/\s+/));
    if (expectedClasses.some((name) => !classes.has(name))) continue;
    matches.push(candidate.index);
  }
  return matches;
}

function htmlAttribute(tag: string, name: string) {
  const escaped = escapeRegExp(name);
  const match = new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function previewWorkspaceFile(
  port: WorkspacePreviewPort,
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) {
  setPreviewHeaders(response);
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    respond(response, 405, "Preview method not allowed", "text/plain");
    return;
  }
  const live = /^\/_preview\/([a-f0-9-]{36})\/design\/([^?#]+\.html)$/i.exec(pathname);
  const historical = /^\/_preview\/([a-f0-9-]{36})\/versions\/([a-f0-9-]{36})\.html$/i.exec(pathname);
  const leaseId = context.binding.appSurfaceLeaseId;
  const routeLeaseId = live?.[1] ?? historical?.[1];
  if (!routeLeaseId || !leaseId || routeLeaseId !== leaseId) {
    respond(response, 401, "Preview surface mismatch", "text/plain");
    return;
  }
  if (
    context.binding.workspaceReadScope !== "design/" ||
    !context.binding.baseCapabilities.includes("workspace-read")
  ) {
    respond(response, 403, "workspace-read capability not granted", "text/plain");
    return;
  }
  let body: Buffer | string | null;
  try {
    if (historical) {
      body = (await port.readVersion(context.binding, requireUuid(historical[2]))).content;
    } else {
      const relative = live?.[2] ?? "";
      if (!isTraversalSafePath(relative)) {
        respond(response, 400, "Preview path is invalid", "text/plain");
        return;
      }
      body = await port.read(context.binding, `design/${relative}`);
    }
  } catch (cause) {
    const status = workspaceFailureStatus(cause);
    respond(response, status, workspaceFailureMessage(status), "text/plain", method === "HEAD");
    return;
  }
  if (body === null) {
    respond(response, 404, "Preview file not found", "text/plain");
    return;
  }
  const html = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  const rendered = injectSelectionBridge(html);
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("content-length", String(Buffer.byteLength(rendered)));
  response.end(method === "HEAD" ? undefined : rendered);
}

function publicVersion(version: WorkspaceVersion) {
  return {
    versionId: version.versionId,
    file: version.canonicalRelativePath,
    digest: version.digest,
    source: version.source,
    parentVersion: version.parentVersion,
    ...(version.restoredFromVersion ? { restoredFromVersion: version.restoredFromVersion } : {}),
    provenance: version.provenance,
    createdAt: version.createdAt,
  };
}

function requireDesignFile(value: unknown) {
  if (typeof value !== "string" || !/^design\/[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i.test(value)) {
    throw Object.assign(new Error("Design file path is invalid"), { status: 400 });
  }
  return value;
}

function requireUuid(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw Object.assign(new Error("Version identity is invalid"), { status: 400 });
  }
  return value;
}

function requireHtmlHint(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 180 ||
    !value.startsWith("<") ||
    !value.endsWith(">") ||
    value.includes("\0")
  ) {
    throw Object.assign(new Error("HTML source hint is invalid"), { status: 400 });
  }
  return value;
}

async function withWorkspaceJson(
  response: ServerResponse,
  operation: () => Promise<object>,
  head = false
) {
  try {
    respond(response, 200, await operation(), "application/json", head);
  } catch (cause) {
    const status = workspaceFailureStatus(cause);
    respond(
      response,
      status,
      workspaceError(workspaceFailureCode(status), workspaceFailureMessage(status)),
      "application/json",
      head
    );
  }
}

function methodNotAllowed(response: ServerResponse, allow: string) {
  response.setHeader("allow", allow);
  respond(response, 405, workspaceError("method_not_allowed", `Allowed methods: ${allow}`), "application/json");
}

/* 穿越安全检查（非画板命名语法）：拒前导斜杠/反斜杠/空字节/`.`/`..` 段。
   画板身份的 canonical 判定在 registry 的 isCanonicalDesignPath，勿与此混淆。 */
function isTraversalSafePath(value: string) {
  return value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

function injectSelectionBridge(html: string) {
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${DESIGN_SELECTION_BRIDGE}`)
    : `${DESIGN_SELECTION_BRIDGE}${html}`;
}

function setPreviewHeaders(response: ServerResponse) {
  response.setHeader("content-security-policy", PREVIEW_CSP);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
}

function workspaceFailureStatus(cause: unknown) {
  const status = Number((cause as { status?: unknown } | null)?.status);
  return [400, 401, 403, 404, 409, 410, 413, 415, 503].includes(status)
    ? status
    : 500;
}

function workspaceFailureCode(status: number) {
  if (status === 400) return "workspace_invalid_request";
  if (status === 410) return "surface_gone";
  if (status === 401 || status === 403) return "workspace_forbidden";
  if (status === 404) return "workspace_not_found";
  if (status === 413) return "workspace_file_too_large";
  if (status === 415) return "workspace_file_invalid";
  if (status === 503) return "workspace_unavailable";
  return status === 409 ? "workspace_changed" : "workspace_read_failed";
}

function workspaceFailureMessage(status: number) {
  return status === 410
    ? "Preview surface is gone"
    : status === 404
      ? "Preview file not found"
      : status === 409
        ? "Workspace changed during preview"
        : status === 400
          ? "Workspace request is invalid"
          : status === 413
            ? "Canvas exceeds the workspace size limit"
            : status === 415
              ? "Canvas is not a valid HTML document"
              : status === 503
                ? "Workspace is temporarily unavailable"
                : "Workspace preview failed";
}

/* code 收窄到共享联合体：wire code 原样透传给 App SDK，这里放宽成 string
   就等于允许产出一个联合体里没有的名字，契约当场退化成注释。 */
function workspaceError(code: AppGuiRuntimeErrorCode, message: string) {
  return { error: { code, message } };
}

function respond(
  response: ServerResponse,
  status: number,
  body: string | object,
  contentType: string,
  head = false
) {
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  /* JSON 工作区 API 与错误响应也要防嗅探/防 Referer 泄露，与预览文档同规格。 */
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-type", `${contentType}; charset=utf-8`);
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  response.end(head ? undefined : serialized);
}
