/**
 * [INPUT]: Original maintained native write-access status, export registrations and a main-authored immutable export-job metadata envelope.
 * [OUTPUT]: Main-frozen menu delegation, token-bound original write-access status and producer invocation with bounded read-only export bytes and actual Canvas/Slides font hooks and concrete transformed-model/exact-picture output previews.
 * [POS]: Trusted editor export adapter; authored child documents cannot access this instance or grant a job.
 */
import type { NativeExportOptions } from "../../cloud-protocol/src/artifacts/design/export/options";
type Preview = { mime: "image/png" | "image/jpeg"; data: string; bytes: number };
const previews: Preview[] = [];
let previewMode: string | undefined, bundleJob = false;
const encode = (bytes: Uint8Array) => { let value = ""; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value); };
function previewImage(bytes: Uint8Array, mime: Preview["mime"]) {
  if (previews.length >= 512 || bytes.length > 2 * 1024 * 1024 || previews.reduce((sum, image) => sum + image.bytes, bytes.length) > 16 * 1024 * 1024) throw new Error("The concrete export preview exceeds its image budget");
  previews.push({ mime, bytes: bytes.length, data: encode(bytes) });
}
type Entry = { format: string; bundle?: boolean; variant?: string; disabled?: boolean; produce(options: {
  interactive: boolean; bundle: boolean; windowMs: number; signal: AbortSignal; nativeOptions: NativeExportOptions;
}): Promise<{ filename: string; data: Blob | ArrayBuffer; warnings?: string[] }> };
type Runtime = { getSlidesWriteAccess?: () => Promise<{ canWrite: boolean; reason?: string }>; buildDeckThemeCss?: (theme: undefined, faces: { family: string; src: string }[]) => string; registeredExportFormats?: readonly Entry[] | null; registeredExportEntries?: readonly Entry[] | null };
export function installNativeExportRuntime(runtime: Runtime, kind: "canvas" | "slides") {
  const token = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content;
  if (token && kind === "slides" && runtime.getSlidesWriteAccess) Object.defineProperty(window, "__bottegaNativeStatus", {
    value: async (proof: string) => { if (proof !== token) throw new Error("The native status belongs to another view");
      const status = await runtime.getSlidesWriteAccess!(); return { canWrite: status.canWrite, reason: status.reason?.slice(0, 500) }; },
  });
  const node = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-export"]');
  if (!token || !node?.content) return;
  if (node.content.length > 32 * 1024) throw new Error("The native export job envelope is too large");
  const options = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(node.content), char => char.charCodeAt(0)))) as NativeExportOptions;
  previewMode = options.fonts.mode; bundleJob = options.bundle;
  node.remove(); document.documentElement.setAttribute("data-bottega-native-export", "1");
  document.documentElement.setAttribute("data-bottega-native-export-bundle", options.bundle ? "1" : "0");
  let running = false;
  Object.defineProperty(window, "__bottegaNativeProduce", { value: async (proof: string) => {
    if (proof !== token || running) throw new Error("The native export belongs to another job or is busy");
    running = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error("The native export exceeded its time budget")), 55_000);
    try {
      const until = Date.now() + 15_000;
      let entry: Entry | undefined;
      while (!entry && Date.now() < until) {
        const entries = kind === "slides" ? runtime.registeredExportEntries : runtime.registeredExportFormats;
        entry = entries?.find(value => value.format === options.format && (options.format !== "html" || Boolean(value.bundle) === options.bundle) && (options.variant === null || value.variant === options.variant));
        if (entry?.disabled) entry = undefined;
        if (!entry) await new Promise(resolve => setTimeout(resolve, 40));
      }
      if (!entry) throw new Error("The original native export producer is unavailable");
      const capturedFonts: { source: string; bytes: number; digest: string }[] = [];
      if (kind === "slides") {
        const response = await fetch(new URL("./project/deck.json", location.href));
        if (!response.ok) throw new Error("The fixed native font index is unavailable");
        const deck = await response.json() as { faces?: Record<string, { family: string; src?: string; href?: string }> };
        const faces = Object.values(deck.faces ?? {}), resources = new Map<string, string>();
        if (faces.length > 4) throw new Error("The fixed native deck exceeds its font budget");
        let total = 0;
        for (const face of faces) {
          if (!face.src || face.href) throw new Error("Capture every selected native font before exporting");
          const relative = /^\/_blob\/[a-f0-9]{32}$/.test(face.src) ? "./" + face.src.slice(1) : "./project/" + face.src;
          const result = await fetch(new URL(relative, location.href), { signal: controller.signal });
          if (!result.ok) throw new Error("A selected native font could not be read");
          const bytes = new Uint8Array(await result.arrayBuffer()); total += bytes.length;
          if (total > 24 * 1024 * 1024) throw new Error("The selected native font resources exceed their byte budget");
          const digest = "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
          let binary = ""; for (let offset = 0; offset < bytes.length; offset += 32 * 1024) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32 * 1024));
          resources.set(face.src, "data:" + (result.headers.get("content-type") ?? "application/octet-stream") + ";base64," + btoa(binary));
          capturedFonts.push({ source: face.src, bytes: bytes.length, digest });
        }
        Object.defineProperty(window, "__bottegaSlidesResources", { value: resources });
        const style = document.createElement("style");
        style.textContent = runtime.buildDeckThemeCss?.(undefined, faces as { family: string; src: string }[]) ?? "";
        document.head.append(style); await document.fonts.ready;
      }
      const output = await entry.produce({ interactive: false, bundle: options.bundle, windowMs: 55_000, signal: controller.signal, nativeOptions: options });
      controller.signal.throwIfAborted();
      const bytes = new Uint8Array(output.data instanceof Blob ? await output.data.arrayBuffer() : output.data);
      if (!bytes.length || bytes.length > 32 * 1024 * 1024 || output.filename.length > 250) throw new Error("The complete native export exceeds its output budget");
      let encoded = "";
      for (let offset = 0; offset < bytes.length; offset += 32 * 1024) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 32 * 1024));
      return { filename: output.filename, data: btoa(encoded), bytes: bytes.length, capturedFonts, previews, warnings: (output.warnings ?? []).slice(0, 64).map(value => value.slice(0, 1000)) };
    } finally { clearTimeout(timer); }
  } });
}

export async function nativeExportFontAudit(root: Element) {
  if (!root.ownerDocument.documentElement.hasAttribute("data-bottega-native-export")) return;
  const audit = (window as Window & { __bottegaNativeFontAudit?: (root: Element) => Promise<void> }).__bottegaNativeFontAudit;
  if (!audit) throw new Error("The original native producer has no output font verifier");
  await audit(root);
}

export function validateNativePptxMedia(deck: { slides: readonly { backdrop?: string; leaves: readonly { kind: string; dataUri?: string; alt?: string }[] }[] }) {
  for (const [index, slide] of deck.slides.entries()) {
    const check = (uri: string | undefined, kind: string) => {
      if (!uri || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(uri))
        throw new Error("Native PPTX slide " + (index + 1) + " " + kind + " is not a complete raster resource: " + String(uri).slice(0, 100));
    };
    if (slide.backdrop !== undefined) check(slide.backdrop, "background");
    for (const leaf of slide.leaves) if (leaf.kind === "img") check(leaf.dataUri, leaf.alt ?? "image");
  }
}

export async function nativeExportCanvasFontAudit(preview: { executeJavaScript(code: string, timeout: number): Promise<unknown> }) {
  if (!document.documentElement.hasAttribute("data-bottega-native-export")) return;
  const audit = (window as Window & { __bottegaNativeCanvasFontAudit?: (preview: unknown) => Promise<void> }).__bottegaNativeCanvasFontAudit;
  if (!audit) throw new Error("The original Canvas producer has no output font verifier");
  await audit(preview);
}

export async function nativeExportCanvasHtmlFontAudit(
  files: readonly string[],
  preview: (file: string) => Promise<{ executeJavaScript(code: string, timeout: number): Promise<unknown> } | null>,
) {
  if (!document.documentElement.hasAttribute("data-bottega-native-export")) return;
  if (!files.length || files.length > 64) throw new Error("The original HTML board range exceeds its audit budget");
  for (const file of files) {
    const handle = await preview(file);
    if (!handle) throw new Error("An original HTML artboard is not ready for font verification");
    await nativeExportCanvasFontAudit(handle);
  }
}

export function nativeMainExport(options: Record<string, unknown>, files?: readonly string[]) {
  if (document.documentElement.hasAttribute("data-bottega-native-export")) return Promise.resolve(undefined);
  const job = (window as Window & { __bottegaNativeExportJob?: (options: Record<string, unknown>, files?: readonly string[]) => Promise<{ filename: string; data: Blob; warnings: string[] }> }).__bottegaNativeExportJob;
  return job ? job(options, files) : Promise.resolve(undefined);
}

export async function nativeExportEditablePreview<S>(slides: readonly S[], assets: ReadonlyMap<string, string>, runtime: {
  initializePdfCapture(): void; fontReadyTimeoutMs: number;
  pdfCaptureExports: { captureSlideAsPng(slide: S | undefined, assets: ReadonlyMap<string, string>, scale: number, options: { packWebFonts: boolean; fontsReadyMs: number; nameMissingFonts: boolean }): Promise<{ png: Uint8Array }> };
}) {
  if (previewMode !== "basic") return;
  runtime.initializePdfCapture();
  for (const slide of slides) {
    const result = await runtime.pdfCaptureExports.captureSlideAsPng(slide, assets, 0.5, { packWebFonts: true, fontsReadyMs: runtime.fontReadyTimeoutMs, nameMissingFonts: true });
    previewImage(result.png, "image/png");
  }
}
export function nativeExportPicturePreviews(pages: readonly { jpeg: Uint8Array }[]) {
  if (previewMode !== "raster") return;
  for (const page of pages) previewImage(page.jpeg, "image/jpeg");
}

export function nativeExportBundleJob() {
  if (typeof document === "undefined") return false;
  const metadata = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-export"]');
  return metadata?.content ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(metadata.content), char => char.charCodeAt(0)))).bundle === true : document.documentElement.getAttribute("data-bottega-native-export-bundle") === "1" || bundleJob;
}
