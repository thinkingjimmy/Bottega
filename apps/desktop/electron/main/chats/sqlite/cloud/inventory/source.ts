/**
 * [INPUT]: Depends on retained SQLite sources, exact hashes and bounded chunk manifests.
 * [OUTPUT]: Reads immutable local source JSON with per-chunk and whole-content verification.
 * [POS]: Worker source reader shared by initial completion and turn capture.
 */
import { z } from "zod";
import type { SqliteDatabase } from "../../connection";
import { digest, type Row } from "../../repository/codec";
import { retainedSourceRefSchema } from "../delivery/contracts";
export const readRetainedSource = (db: SqliteDatabase, reference: { sourceId: string; digest: string }): unknown => {
  const row = db.prepare("SELECT payload_json,digest FROM chat_retained_sources WHERE source_id=?").get(reference.sourceId) as Row | undefined;
  if (!row || row.digest !== reference.digest || digest(String(row.payload_json)) !== reference.digest) throw new Error("INITIAL_SOURCE_CHANGED");
  const value = JSON.parse(String(row.payload_json));
  if (value.encoding !== "canonical-json-chunks-v1") return value;
  const refs = z.array(retainedSourceRefSchema).parse(value.sources), parts: string[] = [];
  let bytes = 0;
  for (const [ordinal, ref] of refs.entries()) {
    const chunk = readRetainedSource(db, ref) as { ordinal: number; text: string };
    if (chunk.ordinal !== ordinal || typeof chunk.text !== "string") throw new Error("INITIAL_SOURCE_CHANGED");
    bytes += Buffer.byteLength(chunk.text); if (bytes > value.bytes + refs.length * 6) throw new Error("INITIAL_SOURCE_BUDGET"); parts.push(chunk.text);
  }
  const text = parts.join(""); if (Buffer.byteLength(text) !== value.bytes || digest(text) !== value.contentDigest) throw new Error("INITIAL_SOURCE_CHANGED");
  return JSON.parse(text);
};
