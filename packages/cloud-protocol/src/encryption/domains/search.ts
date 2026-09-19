/**
 * [INPUT]: Closed browser installation, source revision and fixed seven-day window identities.
 * [OUTPUT]: Local search shard/checkpoint bindings and bounded committed-shard metadata.
 * [POS]: Purpose-six cache identity; never a server search endpoint or plaintext term store.
 */
import { z } from "zod";
import { commitment, digest, id, version } from "./scalars";
const SEARCH_WINDOW_MS = 604_800_000;
const origin = z.string().url().max(512).refine(value => { try { return new URL(value).origin === value; } catch { return false; } });
export const searchBindingSchema = z.object({ role: z.enum(["shard", "checkpoint"]), origin, installationId: z.uuid(), formatVersion: version.positive(),
  indexGeneration: version, sourceRevision: version, fromInclusive: version, throughInclusive: version, invalidation: version,
  shardId: id.nullable(), shardIndex: version.nullable(), shardCount: version, metadataCommitment: digest }).strict().refine(value =>
    value.throughInclusive - value.fromInclusive === SEARCH_WINDOW_MS && (value.role === "checkpoint" ? value.shardId === null && value.shardIndex === null :
      value.shardId !== null && value.shardIndex !== null && value.shardIndex < value.shardCount));
const searchMetadataSchema = z.object({ sourceRevision: version, fromInclusive: version, throughInclusive: version,
  shards: z.array(z.object({ shardId: id, index: version, ciphertextHash: digest, ciphertextBytes: version.positive() }).strict()).max(512) }).strict()
  .refine(value => value.throughInclusive - value.fromInclusive === SEARCH_WINDOW_MS && value.shards.every((shard, index) => shard.index === index) &&
    new Set(value.shards.map(shard => shard.shardId)).size === value.shards.length);
export const hashSearchMetadata = (value: z.input<typeof searchMetadataSchema>) => commitment("search", searchMetadataSchema, value);
