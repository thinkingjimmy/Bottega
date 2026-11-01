/**
 * [INPUT]: Exact original-source snapshot, frozen full producer plan, original or independent shared-job lifetime/generation, strict main-owned Canvas font sources and an abort signal.
 * [OUTPUT]: Bounded original native producer bytes, actual transformed/picture previews and diagnostics from a separate read-only editor with complete teardown.
 * [POS]: Internal producer stage; font/preview validation and private delivery must accept its result separately.
 */
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { artifactRuntime } from "../../../artifacts/core/runtime";
import { nativeExportProjection, type NativeExportSnapshot, type NativeExportPlan } from "./plan";
import { installNativeFontPolicy, nativeCanvasFontPolicy } from "./font-policy";
import { fixedDesignFont } from "../fonts/catalog";
import { beginNativeFontAudit } from "./font-audit";
import { nativeEditorAssets } from "../../../artifacts/render/native/assets";
import { nativeDocumentNotices } from "../notices";
import { designDigest } from "../../documents/model";
let active = 0;
export async function produceNativeExport(input: WorkspaceCommand, snapshot: NativeExportSnapshot, plan: NativeExportPlan, windowId: number, signal: AbortSignal, consumers?: () => void) {
  signal.throwIfAborted(); if (active >= 2) throw new Error("Two native exports are running. Try again after one completes"); active++;
  const gateway = artifactRuntime()!.gateway, lifetime = gateway.guard(windowId);
  const guard = () => { signal.throwIfAborted(); lifetime(); consumers?.(); };
  let window: BrowserWindow | undefined, lease: Awaited<ReturnType<typeof gateway.issueNative>> | undefined;
  let fontControl: Awaited<ReturnType<typeof installNativeFontPolicy>> | undefined;
  const errors: string[] = []; let phase = "prepare", audit: Awaited<ReturnType<typeof beginNativeFontAudit>> | undefined;
  const destroy = () => { if (window && !window.isDestroyed()) window.destroy(); };
  signal.addEventListener("abort", destroy, { once: true });
  const bounded = <T>(task: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); if (signal.aborted) abort();
  });
  try {
    guard(); const projection = nativeExportProjection(snapshot, plan.spec.options);
    phase = "issue-readonly-lease"; lease = await gateway.issueNative(input, windowId, { ...projection, editable: false }, { export: plan.spec.options }); guard();
    const strictCanvas = snapshot.version.manifest.contentFormat === "canvas-dc/v3" && ["strict", "replace"].includes(plan.spec.options.fonts.mode);
    const fontPolicy = strictCanvas ? nativeCanvasFontPolicy(snapshot, lease.url, (await fixedDesignFont()).info.sourceHashes.map(hash => "sha256:" + hash)) : undefined;
    phase = "create-readonly-renderer"; window = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, partition: "native-export-" + randomUUID() } });
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.session.setPermissionCheckHandler(() => false); contents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    const origin = lease.origin;
    contents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "file://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] }, (request, reply) => reply({ cancel: new URL(request.url).origin !== origin }));
    if (fontPolicy) contents.session.webRequest.onHeadersReceived({ urls: [origin + "/*"] }, (details, reply) => {
      const headers = { ...details.responseHeaders }, name = Object.keys(headers).find(key => key.toLowerCase() === "content-security-policy") ?? "Content-Security-Policy";
      headers[name] = [...headers[name] ?? [], fontPolicy.csp]; reply({ responseHeaders: headers });
    });
    contents.on("will-navigate", event => event.preventDefault());
    contents.on("console-message", message => { if (message.level === "error" && errors.length < 8) errors.push(message.message.slice(0, 1000)); });
    phase = "initialize-blank-document"; await bounded(contents.loadURL("about:blank"));
    phase = "install-network-guard"; contents.debugger.attach("1.3");
    await bounded(contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: "for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','RTCIceGatherer']){try{Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false})}catch{}}" }));
    if (fontPolicy) {
      fontControl = await bounded(installNativeFontPolicy(contents, fontPolicy));
    }
    phase = "initialize";
    await bounded(new Promise<void>((resolve, reject) => {
      contents.once("dom-ready", () => resolve());
      void contents.loadURL(lease!.url).catch(reject);
    })); guard(); fontControl?.guard();
    phase = "install-font-audit"; audit = await beginNativeFontAudit(contents, snapshot, plan, lease.url, () => { guard(); fontControl?.guard(); }, Boolean(fontPolicy), fontControl?.sessions);
    phase = "produce";
    const output = await bounded(contents.executeJavaScript("new Promise((resolve,reject)=>{const until=Date.now()+15000;const poll=()=>{if(typeof window.__bottegaNativeProduce==='function')resolve(window.__bottegaNativeProduce(" + JSON.stringify(lease.nativeToken) + "));else if(Date.now()>until)reject(new Error('The original native producer did not initialize'));else setTimeout(poll,40)};poll()})")) as { filename: string; data: string; bytes: number; warnings?: string[]; capturedFonts?: { source: string; bytes: number; digest: string }[]; previews?: { data: string; bytes: number; mime: "image/png" | "image/jpeg" }[] };
    phase = "validate-output"; signal.throwIfAborted(); guard();
    let bytes = Buffer.from(output.data, "base64");
    if (!bytes.length || bytes.length !== output.bytes || bytes.length > plan.spec.producer.byteBudget || bytes.toString("base64") !== output.data) throw new Error("The complete native export has invalid or oversized bytes");
    if (plan.spec.options.format === "html" && !plan.spec.options.bundle) {
      const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!/<\/body>/i.test(html)) throw new Error("The original native HTML document is incomplete");
      const notices = nativeDocumentNotices(await nativeEditorAssets(snapshot.version.manifest.contentFormat!), snapshot.files);
      bytes = Buffer.from(html.replace(/<\/body>/i, notices.toString() + "</body>"));
      if (bytes.length > plan.spec.producer.byteBudget) throw new Error("The complete native HTML and notices exceed their byte budget");
    }
    const previews = (output.previews ?? []).map(image => {
      const data = Buffer.from(image.data, "base64");
      if (!["image/png", "image/jpeg"].includes(image.mime) || data.length !== image.bytes || !data.length || data.length > 2 * 1024 * 1024 || data.toString("base64") !== image.data ||
        (image.mime === "image/png" ? data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" : data.subarray(0, 3).toString("hex") !== "ffd8ff")) throw new Error("The original preview image is incomplete");
      return { data, mime: image.mime, digest: designDigest(data) };
    });
    if (previews.length > 512 || previews.reduce((sum, image) => sum + image.data.length, 0) > 16 * 1024 * 1024) throw new Error("The original preview image budget was exceeded");
    if (!audit.proofs.length) throw new Error("The original native producer did not verify its output fonts");
    if (errors.length) throw new Error("Native export failed: " + errors.join("; "));
    return { bytes, previews, filename: output.filename, digest: designDigest(bytes), exportSpec: plan.spec, exportSpecDigest: plan.digest, warnings: output.warnings ?? [], capturedFonts: output.capturedFonts ?? [], fontProof: [...audit.proofs], fontPolicy: fontPolicy?.receipt };
  } catch (cause) {
    throw Object.assign(new Error("Native original export " + phase + ": " + (cause instanceof Error ? cause.message : String(cause))), { cause, nativeExport: { phase, errors, fontProof: audit?.proofs, fontFailures: audit?.failures } });
  } finally { audit?.close(); fontControl?.close(); signal.removeEventListener("abort", destroy); destroy(); if (lease) gateway.release(lease.id, windowId); active--; }
}
