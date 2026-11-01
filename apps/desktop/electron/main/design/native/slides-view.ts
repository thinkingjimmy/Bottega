/**
 * [INPUT]: One immutable section, fixed viewer/CSS bytes and captured native deck font resources.
 * [OUTPUT]: Offline native Slides document HTML with inert JSON source and an exact source-built viewer.
 * [POS]: Fixed Slides preview/export composition; authored content runs only in the opaque renderer.
 */
export function nativeSlideHtml(input: { source: string; slideId: string; viewer: Uint8Array; css: Uint8Array; faces: { family: string; src: string }[]; resources: [string, string][] }) {
  const payload = JSON.stringify({ source: input.source, slideId: input.slideId, faces: input.faces, resources: input.resources }).replaceAll("<", "\\u003c");
  const script = "data:text/javascript;base64," + Buffer.from(input.viewer).toString("base64");
  return Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + Buffer.from(input.css).toString("utf8").replace(/<\/style/gi, "<\\/style") +
    'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}#bottega-slide-root{position:relative;width:100%;height:100%;overflow:hidden}</style></head>' +
    '<body><div id="bottega-slide-root"></div><script type="application/json" id="bottega-slide-source">' + payload + '</script><script src="' + script + '"></script></body></html>');
}
