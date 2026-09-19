/**
 * [INPUT]: Depends on renderer Sketch documents and generic draft/queue attachment identities.
 * [OUTPUT]: Provides Sketch resources, reference-union collection, integrity checks, and pure queue extra bytes.
 * [POS]: Pure composer resource model; editable sources never enter file or submission DTOs.
 */
import {
  validateDocument,
  type SketchDocument,
} from "@ai-chat/chat-ui/sketch/model/document";
import type { MessageQueue } from "../message-queue-model";
export type ComposerSketchResources = Readonly<{
  sketchAttachmentIds: ReadonlySet<string>;
  sources: ReadonlyMap<
    string,
    Readonly<{ document: SketchDocument; byteLength: number }>
  >;
  submissionPins: ReadonlyMap<string, readonly string[]>;
  editorPins: ReadonlyMap<string, readonly string[]>;
}>;
export const emptySketchResources = (): ComposerSketchResources => ({
  sketchAttachmentIds: new Set(),
  sources: new Map(),
  submissionPins: new Map(),
  editorPins: new Map(),
});
const validatedSources = new WeakSet<SketchDocument>();
export function assertSketchSources(
  resources: ComposerSketchResources,
  ids: Iterable<string>,
) {
  for (const id of ids) {
    if (!resources.sketchAttachmentIds.has(id)) continue;
    const source = resources.sources.get(id);
    if (!source) throw new Error("SKETCH_SOURCE_MISSING");
    if (!validatedSources.has(source.document)) {
      validateDocument(source.document);
      validatedSources.add(source.document);
    }
  }
}
export const sketchQueueExtraBytes =
  (resources: ComposerSketchResources) => (queue: MessageQueue) => {
    const ids = new Set(
      queue.items.flatMap((item) =>
        item.prompt.attachments.map((file) => file.id),
      ),
    );
    assertSketchSources(resources, ids);
    let bytes = 0;
    for (const id of ids) bytes += resources.sources.get(id)?.byteLength ?? 0;
    return bytes;
  };
export function collectSketchResources(
  resources: ComposerSketchResources,
  draftIds: Iterable<string>,
  queue: MessageQueue,
): ComposerSketchResources {
  const referenced = new Set([
    ...draftIds,
    ...queue.items.flatMap((item) =>
      item.prompt.attachments.map((file) => file.id),
    ),
    ...[
      ...resources.submissionPins.values(),
      ...resources.editorPins.values(),
    ].flat(),
  ]);
  if (
    [...resources.sketchAttachmentIds].every((id) => referenced.has(id)) &&
    [...resources.sources.keys()].every((id) => referenced.has(id))
  )
    return resources;
  return {
    ...resources,
    sketchAttachmentIds: new Set(
      [...resources.sketchAttachmentIds].filter((id) => referenced.has(id)),
    ),
    sources: new Map(
      [...resources.sources].filter(([id]) => referenced.has(id)),
    ),
  };
}
