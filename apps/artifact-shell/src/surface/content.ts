/**
 * [INPUT]: Plaintext compiled-App files, the entry path, shared document preparation and the hop-2 runtime.
 * [OUTPUT]: prepareSurface: the App's own entry document, made self-contained, with the surface runtime ahead of App code.
 * [POS]: Surface-specific preparation; unlike artifacts there is no viewer shell, theme runtime or CDN.
 */
import { parse } from "parse5";
import { artifactResourcePath, type ArtifactResource } from "../shared/resources";
import { prepareDocument } from "../shared/document";
import { surfaceAppRuntime } from "./runtime";
export function prepareSurface(files: ArtifactResource[], entry: string): string {
  const file = files.find(item => item.path === entry); if (!file) throw new Error("surface-entry-missing");
  const doc = parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  return prepareDocument(doc, files, artifactResourcePath(entry), `<script>${surfaceAppRuntime()}</script>`);
}
