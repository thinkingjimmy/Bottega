/**
 * [INPUT]: Immutable system revision, full resource bytes and the verified native document runtime.
 * [OUTPUT]: isSystemDcBoard permits native rendering only for a digest-verified DC preview with actual mount evidence.
 * [POS]: Snapshot-to-native rendering boundary; arbitrary system HTML cannot request the native policy.
 */
import { nativeEditorAssets } from "../../../artifacts/render/native/assets";
import { designDigest, DesignDocumentError } from "../../documents/model";
import type { DesignRevision } from "../../documents/store";
import { transformedDesignSet } from "../../documents/edits";
import { readDesignSystem, validateDesignSystem } from "../validation";
export async function isSystemDcBoard(snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[] }, file: string) {
  if (snapshot.version.manifest.format !== "bottega-design-system") return false;
  const parsed = readDesignSystem(snapshot.files, snapshot.version.manifest);
  const dc = parsed.system?.components.components.map(component => component.dc).find(dc => dc?.status === "ready" && dc.preview === file);
  if (!dc || dc.status !== "ready") return false;
  if (dc.systemId !== snapshot.version.manifest.documentId) throw new DesignDocumentError("INVALID_DOCUMENT", "DC preview belongs to another fixed system");
  if (parsed.issues.length || validateDesignSystem(transformedDesignSet(snapshot.version.path, snapshot.files)).length)
    throw new DesignDocumentError("INVALID_DOCUMENT", "DC preview requires its complete fixed system evidence");
  const runtime = (await nativeEditorAssets()).get("artifact-type/dc-runtime.js");
  if (!runtime || designDigest(runtime) !== dc.runtimeDigest) throw new DesignDocumentError("INVALID_DOCUMENT", "DC preview runtime changed; rebuild the captured source target");
  return true;
}
