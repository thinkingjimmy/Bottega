/**
 * [INPUT]: One immutable validated native deck snapshot.
 * [OUTPUT]: Original non-skipped page order/plain notes and a separately projected audience source without private notes or review comments.
 * [POS]: Presentation source boundary; source bytes and its publication journal stay unchanged.
 */
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { normalizeNativeExportOptions } from "@ai-chat/cloud-protocol/artifacts/design/export/options";
import { nativeExportProjection, type NativeExportSnapshot } from "../exports/plan";
type Node = DefaultTreeAdapterMap["node"];
const text = (node: Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
export function nativePresentationSource(snapshot: NativeExportSnapshot) {
  if (snapshot.version.manifest.contentFormat !== "slides/v4") throw new Error("Present an original native Slides deck");
  const pages = snapshot.version.manifest.boards.flatMap(board => {
    const file = snapshot.files.find(file => file.path === board.file); if (!file) throw new Error("The fixed presentation page is missing");
    const root = parseFragment(new TextDecoder("utf-8", { fatal: true }).decode(file.data)).childNodes.find(node => "tagName" in node && node.tagName === "section");
    if (!root || !("attrs" in root) || !("childNodes" in root)) throw new Error("The original presentation section is missing");
    if (root.attrs.some(attribute => attribute.name === "hidden")) return [];
    const id = root.attrs.find(attribute => attribute.name === "id")?.value;
    if (!id) throw new Error("The fixed presentation slide identity is missing");
    const note = root.childNodes.find(node => "tagName" in node && node.tagName === "aside");
    return [{ id, boardId: board.id, title: board.title, notes: note ? text(note) : "" }];
  });
  if (!pages.length) throw new Error("Unskip a slide before presenting");
  const options = normalizeNativeExportOptions({ format: "pptx", pages: pages.map(page => page.boardId), notes: false },
    { contentFormat: "slides/v4", pages: snapshot.version.manifest.boards.map(board => board.id), launchPage: snapshot.version.manifest.launchBoard });
  const audience = nativeExportProjection(snapshot, options);
  return { pages, audience: { ...audience, files: audience.files.filter(file => file.path !== "comments.json") } };
}
export type NativePresentationPage = ReturnType<typeof nativePresentationSource>["pages"][number];
