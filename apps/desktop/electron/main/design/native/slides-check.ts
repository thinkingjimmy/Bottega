/**
 * [INPUT]: Complete immutable native Slides source, safe captured font declarations, bounded color literals and the verified inert boot:false compiler identity.
 * [OUTPUT]: checkNativeSlides semantic diagnostics and nativeSlideColors original color mappings in bounded workers without authored execution or main-loop blocking.
 * [POS]: Shared original native compiler gate; the same two-worker bound covers source checks and system color conversion.
 */
import { nativeSlideFontHead } from "@ai-chat/cloud-protocol/artifacts/design/native/font-face";
import { Worker } from "node:worker_threads";
import { nativeSlidesCompiler } from "../../artifacts/render/native/assets";
import { DesignDocumentError, type DesignIssue } from "../documents/model";
let active = 0;
const code = [
  'const {parentPort,workerData}=require("node:worker_threads");',
  'const {readFileSync}=require("node:fs");const {createHash}=require("node:crypto");',
  'if(createHash("sha256").update(readFileSync(workerData.path)).digest("hex")!==workerData.sha256)throw new Error("Fixed Slides compiler changed");',
  'const {runtime}=require(workerData.path);const issues=[];const before=globalThis.__bottegaAuthoredSlideRan;',
  'if(workerData.colors){parentPort.postMessage(workerData.colors.map(value=>runtime.normalizeDesignTokenColor(value)??null))}else{',
  'for(const file of workerData.slides){const result=runtime.compileSlideHtml("<!doctype html><html><head>"+workerData.fontHead+"</head><body>"+file.source+"</body></html>",{collectFiles:true,fileMap:new Map(workerData.paths.map(path=>[path,path]))});',
  'for(const item of [...result.errors,...result.unsupported]){if(issues.length<32)issues.push({file:file.path,message:(String(item.line)+":"+String(item.col)+" "+item.message).slice(0,500)})}}',
  'if(globalThis.__bottegaAuthoredSlideRan!==before)throw new Error("Authored slide code was evaluated");parentPort.postMessage(issues)}',
].join("\n");
async function task<T>(data: object, fixed?: Awaited<ReturnType<typeof nativeSlidesCompiler>>): Promise<T> {
  if (active >= 2) throw new DesignDocumentError("NOT_READY", "Two native checks are running. Try again after one completes.");
  active++;
  try {
    const compiler = fixed ?? await nativeSlidesCompiler();
    return await new Promise<T>((resolve, reject) => {
      const worker = new Worker(code, { eval: true, workerData: { ...compiler, ...data }, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Native source conversion exceeded its time budget")), 30_000);
      const finish = (cause?: Error, value?: T) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); if (cause) reject(cause); else resolve(value!); };
      worker.once("message", value => finish(undefined, value)); worker.once("error", cause => finish(cause));
      worker.once("exit", code => { if (!settled) finish(new Error("Native compiler stopped (" + code + ")")); });
    });
  } finally { active--; }
}
export async function nativeSlideColors(values: readonly string[]) {
  if (values.length > 4096 || values.some(value => value.length > 1000) || Buffer.byteLength(JSON.stringify(values)) > 8 * 1024 * 1024)
    throw new DesignDocumentError("BUDGET_EXCEEDED", "The complete native color map exceeds its budget");
  const compiler = await nativeSlidesCompiler(), colors = await task<(string | null)[]>({ colors: values }, compiler);
  if (colors.length !== values.length || colors.some(value => value !== null && (typeof value !== "string" || value.length > 128))) throw new Error("The fixed native color result is invalid");
  return { colors, runtimeDigest: "sha256:" + compiler.sha256 };
}
export async function checkNativeSlides(files: readonly { path: string; data: Uint8Array }[]): Promise<DesignIssue[]> {
  const deck = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.find(file => file.path === "deck.json")!.data)) as { faces?: Record<string, { family: string; src?: string; href?: string }> };
  const faces = Object.values(deck.faces ?? {});
  if (faces.some(face => !face.src || face.href)) throw new DesignDocumentError("INVALID_DOCUMENT", "Capture the selected Slides font resources before checking");
  const fontHead = nativeSlideFontHead(faces as { family: string; src: string }[]);
  const slides = files.filter(file => /^slides\/[^/]+\.html$/.test(file.path)).map(file => ({ path: file.path, source: new TextDecoder("utf-8", { fatal: true }).decode(file.data) }));
  return task<DesignIssue[]>({ slides, fontHead, paths: files.map(file => file.path) });
}
