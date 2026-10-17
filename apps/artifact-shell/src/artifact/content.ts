/**
 * [INPUT]: Validated snapshot files, fixed design/system manifest/view identity, shared offline frame policy and ordinary viewer preparation.
 * [OUTPUT]: Self-contained ordinary viewer documents and frozen multi-board design documents with complete local resources.
 * [POS]: Artifact-specific preparation; resource, module and runtime handling lives in shared/document.ts.
 */
import { parse } from "parse5";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactViewerShell } from "@ai-chat/cloud-protocol/artifacts/viewer-shell";
import { artifactResourcePath, type ArtifactResource } from "../shared/resources";
import { prepareDocument } from "../shared/document";
import { designFrameHtml, type DesignFrameIdentity } from "@ai-chat/cloud-protocol/artifacts/design/frame";
import { manifestSchema } from "@ai-chat/cloud-protocol/artifacts/design/model";
export type { ArtifactResource } from "../shared/resources";
export function prepareContent(fence: ArtifactFence, files: ArtifactResource[], theme: "light" | "dark", design?: DesignFrameIdentity): string {
  const manifest = fence.design ? manifestSchema.parse(JSON.parse(new TextDecoder().decode(files.find(file => file.path === "canvas.json")!.bytes))) : null;
  const board = manifest?.boards.find(board => board.id === (design?.boardId ?? fence.design?.launchBoard));
  const entry = board?.file ?? (fence.kind === "static-site" ? fence.entry : files[0]!.path);
  const file = files.find(file => file.path === entry); if (!file) throw new Error("artifact-entry-missing");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  const doc = parse(design ? designFrameHtml(source, design) : artifactViewerShell({ html: source, title: fence.title,
    document: fence.kind === "static-site" || fence.kind === "html-document", theme }));
  return prepareDocument(doc, files, artifactResourcePath(entry!), "", Boolean(design));
}
