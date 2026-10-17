/**
 * [INPUT]: Validated Canvas objects and a host-supplied fixed image URL resolver.
 * [OUTPUT]: Escaped canonical text/note/shape/drawing/image markup without scripts or arbitrary CSS.
 * [POS]: Shared rendering projection for saved board layers, page objects and immutable exports.
 */
import type { CanvasObject } from "./model";
export const escapeCanvasText = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function canvasObjectMarkup(object: CanvasObject, imageUrl: (path: string) => string | null) {
  const { x, y, width, height } = object.bounds, escape = escapeCanvasText;
  const style = Object.entries(object.style ?? {}).map(([key, value]) => `${key}:${value}!important`).join(";");
  const base = `position:absolute!important;display:block!important;box-sizing:border-box!important;pointer-events:auto!important;left:${x}px!important;top:${y}px!important;width:${width}px!important;height:${height}px!important;margin:0!important;overflow:hidden;${style}`;
  let content: string;
  if (object.kind === "text" || object.kind === "note") {
    content = escape(object.text);
    if (object.kind === "text" && object.list && object.list !== "none") {
      const tag = object.list === "ordered" ? "ol" : "ul";
      content = `<${tag} style="margin:0;padding-left:1.5em">${object.text.split("\n").map(line => `<li>${escape(line)}</li>`).join("")}</${tag}>`;
    }
    if (object.kind === "text" && object.href) content = `<a href="${escape(object.href)}" style="color:inherit">${content}</a>`;
    const note = object.kind === "note" ? "background:#fff3ad!important;padding:12px!important;color:#252525!important;" : "";
    return `<div id="${object.id}" data-bottega-object="${object.id}" style="${note}${escape(base)};white-space:pre-wrap">${content}</div>`;
  }
  if (object.kind === "image") {
    const url = imageUrl(object.asset.path); if (!url) throw new Error("Canvas image is missing from the fixed resource closure");
    return `<img id="${object.id}" data-bottega-object="${object.id}" src="${escape(url)}" alt="${escape(object.alt)}" style="${escape(base)};object-fit:contain">`;
  }
  const attrs = `fill="${escape(object.fill)}" stroke="${escape(object.stroke)}" stroke-width="${object.strokeWidth}" style="fill:${escape(object.fill)}!important;stroke:${escape(object.stroke)}!important;stroke-width:${object.strokeWidth}!important" vector-effect="non-scaling-stroke"`;
  if (object.kind === "rectangle") content = `<rect x="0" y="0" width="100" height="100" ${attrs}/>`;
  else if (object.kind === "ellipse") content = `<ellipse cx="50" cy="50" rx="50" ry="50" ${attrs}/>`;
  else if (object.kind === "drawing") content = `<polyline points="${object.points.map(point => `${point.x * 100},${point.y * 100}`).join(" ")}" ${attrs} fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  else {
    const [from, to] = object.points ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    content = `<line x1="${from!.x * 100}" y1="${from!.y * 100}" x2="${to!.x * 100}" y2="${to!.y * 100}" ${attrs}/>`;
    if (object.kind === "arrow") {
      const dx = (to!.x - from!.x) * width, dy = (to!.y - from!.y) * height, distance = Math.hypot(dx, dy) || 1;
      const length = Math.min(12, distance / 3), ux = dx / distance, uy = dy / distance;
      const point = (side: number) => `${(to!.x - (ux * length - uy * length * side / 2) / width) * 100},${(to!.y - (uy * length + ux * length * side / 2) / height) * 100}`;
      content += `<polyline points="${point(-1)} ${to!.x * 100},${to!.y * 100} ${point(1)}" ${attrs} fill="none"/>`;
    }
  }
  return `<svg id="${object.id}" data-bottega-object="${object.id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="${escape(base)};overflow:visible">${content}</svg>`;
}
