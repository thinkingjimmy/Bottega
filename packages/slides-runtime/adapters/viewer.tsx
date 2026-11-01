/**
 * [INPUT]: One immutable native section, safe pre-compile captured font declarations and the original boot:false Slides runtime.
 * [OUTPUT]: Read-only native SlideSurface with actual layout, font/image readiness and flattened opaque graphics.
 * [POS]: Fixed snapshot entry inside the opaque document frame; no file, comment or host write capabilities.
 */
import { nativeSlideFontHead } from "@ai-chat/cloud-protocol/artifacts/design/native/font-face";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { RuntimeBindings } from "../.build/source/packages/slides-runtime/src/bindings";
type Payload = { source: string; slideId: string; faces: { family: string; src: string }[]; resources: [string, string][] };
export async function startSlidesViewer(runtime: RuntimeBindings) {
  const node = document.getElementById("bottega-slide-source"), host = document.getElementById("bottega-slide-root");
  if (!node?.textContent || !host) throw new Error("The fixed native slide is unavailable");
  const payload = JSON.parse(node.textContent) as Payload;
  Object.defineProperty(window, "__bottegaSlidesResources", { value: new Map(payload.resources) });
  runtime.initializePdfCapture();
  const source = "<!doctype html><html><head>" + nativeSlideFontHead(payload.faces) + "</head><body>" + payload.source + "</body></html>";
  const result = runtime.compileSlideHtml(source, { collectFiles: true, fileMap: new Map(payload.resources.map(([path]) => [path, path])) });
  if (result.errors.length) throw new Error("The native slide has compiler errors");
  const slide = result.content.slides[payload.slideId];
  if (!slide || result.content.order.length !== 1) throw new Error("The fixed native slide identity changed");
  runtime.setRenderingTheme(result.content.theme);
  const css = runtime.buildDeckThemeCss(result.content.fonts, result.content.faces);
  if (/@import\s+(?:url\()?\s*["']?https?:/i.test(css)) throw new Error("Capture the selected font resources before rendering this slide");
  const style = document.createElement("style"); style.textContent = css; document.head.append(style);
  const root = createRoot(host);
  runtime.renderReactSynchronously(root, createElement("div", { "data-pdf-slide": "0", style: { position: "absolute", left: "50%", top: "50%", width: 1920, height: 1080 } },
    createElement(runtime.SlideSurface, { slide, assets: new Map(Object.entries(result.content.assets)), animate: false, clips: "none" })));
  const scene = host.firstElementChild as HTMLElement;
  const fit = () => { scene.style.transform = "translate(-50%,-50%) scale(" + Math.max(.0001, Math.min(innerWidth / 1920, innerHeight / 1080)) + ")"; };
  fit(); addEventListener("resize", fit, { passive: true });
  host.getBoundingClientRect();
  if (slide.frames.some(frame => frame.node.kind === "html")) {
    const warnings: string[] = [], captures = await runtime.rasterizeEmbedFrames(host, [slide], warnings);
    if (warnings.length || slide.frames.some(frame => frame.node.kind === "html" && !captures.get(0)?.has(frame.id)))
      throw new Error("An opaque slide graphic could not be captured");
    for (const [frameId, uri] of captures.get(0) ?? []) {
      const target = host.querySelector('[data-frame-id="' + CSS.escape(frameId) + '"] [data-node-path=""]');
      if (!target) throw new Error("The captured slide graphic is missing");
      const image = new Image(); image.src = uri; image.alt = ""; image.style.cssText = "width:100%;height:100%;object-fit:contain;display:block";
      await image.decode(); target.replaceChildren(image);
    }
  }
  await document.fonts.ready;
  for (const image of host.querySelectorAll("img")) await image.decode();
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  document.documentElement.setAttribute("data-bottega-document-mounted", "1");
}
