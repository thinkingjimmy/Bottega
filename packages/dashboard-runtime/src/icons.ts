/**
 * [INPUT]: Licensed Lucide Download, MousePointer2, Pencil, PanelRight, File, Braces and X SVG geometry.
 * [OUTPUT]: Sharp accessible native toolbar and Sources icons with original control dimensions.
 * [POS]: Trusted Dashboard presentation; ISC notice is emitted in third-party-licenses.txt.
 */
export function dashboardIcon(kind: "history" | "export" | "select" | "edit" | "sources" | "file" | "calculation" | "close") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
  const paths = { history: ["M3 12a9 9 0 1 0 2.4-6.1L3 8", "M3 3v5h5", "M12 7v5l3 2"], export: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"], select: ["m4 3 7.07 17 2.51-6.42L20 11.07 4 3z"], edit: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.5z", "m15 5 4 4"], sources: ["M3 3h18v18H3z", "M16 3v18"], file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"], calculation: ["M8 3H6a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2", "M16 3h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2"], close: ["M18 6 6 18", "m6 6 12 12"] }[kind];
  for (const value of paths) { const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", value); svg.append(path); }
  return svg;
}
