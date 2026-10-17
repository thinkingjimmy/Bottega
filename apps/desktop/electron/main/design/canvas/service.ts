/**
 * [INPUT]: Main snapshot/Chat custody, current Artifact generation and closed Canvas operations.
 * [OUTPUT]: Owner-verified target capabilities and one CAS journal edit per Canvas batch or property action.
 * [POS]: Workspace Canvas adapter; no second save log, caller filesystem roots or client-generated identities.
 */
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { CanvasOperation, CanvasTarget } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { DESIGN_PROPERTIES, validDesignProperty, canvasStyleSchema, type CanvasObject } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { artifactCanvasTargetSchema } from "@ai-chat/cloud-protocol/resources/artifact/model";
import { locateDesignElement, resolveDesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/anchors";
import { designDocuments } from "../documents/runtime";
import type { DesignRevision } from "../documents/store";
import { DesignDocumentError } from "../documents/model";
import { assertArtifactGeneration } from "../../artifacts/admission/state";
import { artifactRuntime } from "../../artifacts/core/runtime";
import { inspectCanvasSource, type SourceOperation } from "./source";
import { transformCanvas } from "./transform";
type Snapshot = { version: DesignRevision; editable: boolean; files: { path: string; data: Uint8Array }[] };
function targetObject(input: WorkspaceCommand, snapshot: Snapshot) {
  if (!input.anchor) throw new DesignDocumentError("INVALID_DOCUMENT", "Select one current source target");
  const board = snapshot.version.manifest.boards.find(board => board.id === input.anchor!.boardId);
  const file = snapshot.files.find(file => file.path === board?.file);
  if (!file) throw new DesignDocumentError("PATH_DENIED", "Target belongs to another board or document");
  const html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.data), anchor = resolveDesignAnchor(html, input.anchor).anchor;
  let node: ReturnType<typeof locateDesignElement> | null = locateDesignElement(html, anchor);
  let id: string | undefined;
  for (; node; node = node.parentNode && "tagName" in node.parentNode ? node.parentNode : null) {
    id = node.attrs.find(value => value.name === "data-bottega-object")?.value; if (id) break;
  }
  const object = id ? snapshot.version.manifest.objects?.find(object => object.id === id && object.boardId === board!.id) : undefined;
  return { html, anchor, object };
}
export function canvasTarget(input: WorkspaceCommand, snapshot: Snapshot): CanvasTarget {
  let target: CanvasTarget;
  try {
    const { html, anchor, object } = targetObject(input, snapshot);
    if (!object) target = inspectCanvasSource(html, anchor);
    else {
      const text = object.kind === "text" || object.kind === "note", typography = text;
      const properties = DESIGN_PROPERTIES.filter(key => {
        if (key === "text") return text;
        if (["left", "top", "width", "height"].includes(key)) return true;
        if (key === "color") return text || "fill" in object;
        if (key === "background-color") return text || object.kind === "image";
        return typography && Object.hasOwn(canvasStyleSchema.shape, key);
      });
      target = { anchor, objectId: object.id, editable: true, reason: null, properties,
        values: { ...object.style, left: object.bounds.x + "px", top: object.bounds.y + "px", width: object.bounds.width + "px", height: object.bounds.height + "px", ...(text ? { text: object.text } : {}),
          ...("fill" in object ? { color: ["line", "arrow", "drawing"].includes(object.kind) ? object.stroke : object.fill } : {}) },
        text, typography, geometry: true, link: object.kind === "text", list: object.kind === "text",
        ...(object.kind === "text" ? { href: object.href ?? null, listMode: object.list ?? "none" } : {}) };
    }
  } catch (cause) {
    if (!input.anchor) throw cause;
    target = { anchor: input.anchor, editable: false, reason: cause instanceof Error ? cause.message.slice(0, 500) : "Select a source target again", properties: [], values: {}, text: false, typography: false, geometry: false, link: false, list: false };
  }
  const latest = designDocuments().store.latest(snapshot.version.authority.ownerId, snapshot.version.manifest.documentId, snapshot.version.authority);
  if (snapshot.version.manifest.format !== "bottega-design") target = { ...target, editable: false, reason: "Use the saved design system token and component controls for this document." };
  else if (!snapshot.editable || latest?.artifactId !== snapshot.version.artifactId) target = { ...target, editable: false, reason: "This fixed historical snapshot is read only. Open the current version to edit." };
  const answer = artifactCanvasTargetSchema.safeParse(target);
  if (answer.success) return answer.data;
  const { properties: _hints, ...anchor } = target.anchor;
  return { anchor, editable: false, reason: "This target exceeds the bounded source capability reply. Use the Agent for its complete source.", properties: [], values: {}, text: false, typography: false, geometry: false, link: false, list: false };
}
function objectSourceEdit(object: CanvasObject, operation: SourceOperation): CanvasOperation {
  const changes: Record<string, unknown> = {}, bounds = { ...object.bounds }, style = { ...object.style };
  for (const [key, value] of Object.entries(operation.changes ?? {})) {
    if (value === undefined) continue;
    if (!validDesignProperty(key, value)) throw new DesignDocumentError("INVALID_DOCUMENT", "Use a supported literal object property: " + key);
    if (key === "color" && "fill" in object) { changes[["line", "arrow", "drawing"].includes(object.kind) ? "stroke" : "fill"] = value; continue; }
    if (key === "text") { if (!["text", "note"].includes(object.kind)) throw new DesignDocumentError("INVALID_DOCUMENT", "This Canvas object has no text"); changes.text = value; }
    else if (["left", "top", "width", "height"].includes(key)) {
      if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value)) throw new DesignDocumentError("INVALID_DOCUMENT", "Object geometry uses literal pixels");
      bounds[key === "left" ? "x" : key === "top" ? "y" : key as "width" | "height"] = parseFloat(value); changes.bounds = bounds;
    } else {
      if (!["color", "background-color"].includes(key) && !["text", "note"].includes(object.kind)) throw new DesignDocumentError("INVALID_DOCUMENT", "This object does not support typography");
      if (!Object.hasOwn(style, key) && ["padding", "gap"].includes(key)) throw new DesignDocumentError("INVALID_DOCUMENT", "This object does not support container spacing");
      (style as Record<string, string>)[key] = value; changes.style = style;
    }
  }
  if (operation.href !== undefined) changes.href = operation.href; if (operation.list !== undefined) changes.list = operation.list;
  return { type: "object.update", objectId: object.id, changes } as CanvasOperation;
}
export function editCanvasRevision(input: WorkspaceCommand, snapshot: Snapshot) {
  if (!snapshot.editable) throw new DesignDocumentError("PATH_DENIED", "This retained snapshot has no source editing authority");
  let operations: CanvasOperation[];
  if (input.action === "patch") {
    if (!input.anchor || !input.property || input.value === undefined) throw new DesignDocumentError("INVALID_DOCUMENT", "Select a property and current source target");
    operations = [{ type: "source.update", anchor: input.anchor, changes: { [input.property]: input.value } }];
  } else operations = input.operations ?? [];
  // Model-owned objects always modify the object model, including legacy finite-property saves.
  operations = operations.map(operation => {
    if (operation.type !== "source.update") return operation;
    try {
      const { object } = targetObject({ ...input, anchor: operation.anchor }, snapshot);
      return object ? objectSourceEdit(object, operation) : operation;
    } catch (cause) { if (cause instanceof DesignDocumentError) throw cause; throw new DesignDocumentError("INVALID_DOCUMENT", cause instanceof Error ? cause.message.slice(0, 500) : "Select a current source target again"); }
  });
  return designDocuments().edit(input, snapshot.version, source => transformCanvas(source, input.requestId!, operations, {
    async readImage(image) {
      assertArtifactGeneration(input.generation);
      const resolved = await artifactRuntime()!.resolve({ chatId: input.chatId, incarnationId: input.incarnationId, artifactId: image.artifactId });
      assertArtifactGeneration(input.generation);
      if (resolved.record.fence.kind !== "image" || resolved.record.fence.sha256 !== image.digest.slice(7)) throw new DesignDocumentError("PATH_DENIED", "Image must be a fixed admitted raster Artifact from this Chat");
      return resolved.data;
    },
  }), () => assertArtifactGeneration(input.generation));
}
