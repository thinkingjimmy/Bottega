/**
 * [INPUT]: Validated snapshot files, the shared viewer shell and shared document preparation.
 * [OUTPUT]: prepareContent: a self-contained artifact document wrapped in the shared viewer shell.
 * [POS]: Artifact-specific preparation; resource, module and runtime handling lives in shared/document.ts.
 */
import { parse } from "parse5";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactViewerShell } from "@ai-chat/cloud-protocol/artifacts/viewer-shell";
import { artifactResourcePath, type ArtifactResource } from "../shared/resources";
import { prepareDocument } from "../shared/document";
export type { ArtifactResource } from "../shared/resources";
export function prepareContent(fence: ArtifactFence, files: ArtifactResource[], theme: "light" | "dark"): string {
  const entry = fence.kind === "static-site" ? fence.entry : files[0]!.path;
  const file = files.find(file => file.path === entry); if (!file) throw new Error("artifact-entry-missing");
  const doc = parse(artifactViewerShell({ html: new TextDecoder("utf-8", { fatal: true }).decode(file.bytes), title: fence.title,
    document: fence.kind === "static-site" || fence.kind === "html-document", theme }));
  return prepareDocument(doc, files, artifactResourcePath(entry!));
}
