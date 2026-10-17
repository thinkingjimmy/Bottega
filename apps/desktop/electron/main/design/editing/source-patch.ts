/**
 * [INPUT]: Immutable original HTML, a version-bound anchor and one finite literal property/value.
 * [OUTPUT]: Shared Canvas source patching and unique anchor resolution for existing consumers.
 * [POS]: Property compatibility entry; source safety and typography rules live in canvas/source.
 */
import type { DesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { designPropertySchema } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { patchCanvasSource } from "../canvas/source";
export { resolveDesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/anchors";
export function patchDesignSource(html: string, anchor: DesignAnchor, property: string, value: string) {
  return patchCanvasSource(html, { type: "source.update", anchor, changes: { [designPropertySchema.parse(property)]: value } });
}
