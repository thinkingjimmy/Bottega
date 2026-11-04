/**
 * [INPUT]: One immutable consumer manifest and its complete captured portable System copy.
 * [OUTPUT]: Exact fixed System snapshot with no live-Chat lookup or write authority.
 * [POS]: Read-only Theme browser boundary; the consumer lease owns access and lifetime.
 */
import type { DesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { readPortableSystem } from "../../projects/portable";
export function fixedSystemSnapshot(manifest: DesignManifest, files: readonly {path:string;data:Uint8Array}[], systemId:string) {
  const binding=manifest.systems?.find(value=>value.documentId===systemId);
  if (!binding) throw new Error("Choose a fixed System attached to this work");
  if (!binding.copy) throw new Error("Bind this saved System again to include its complete read-only copy");
  return readPortableSystem(files,binding);
}
