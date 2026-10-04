/**
 * [INPUT]: Depends on Zod only.
 * [OUTPUT]: Provides the R-33 Memory status plaintext: closed state and issue enums, timestamps only, at most 160 bytes.
 * [POS]: packages/cloud-protocol/src/remote/memory; remote/'s leaf for the phone Memory facade, imported by the plain target model and the sealing codec (memory.ts) without a cycle.
 */
import { z } from "zod";

export const REMOTE_MEMORY_PLAINTEXT_BYTES = 160;
/* Milliseconds since the epoch keep 13 digits until the year 2286; the bound holds the largest status within 160 bytes. */
const HOUR = 3_600_000, time = z.number().int().nonnegative().max(9_999_999_999_999);
export const remoteMemoryStateSchema = z.enum(["off", "setting-up", "setup-incomplete", "paused", "on", "issue"]);
export const remoteMemoryIssueSchema = z.enum(["unreachable", "unhealthy", "auth", "version", "protocol", "configuration", "identity"]);
/* No detail text, address, path, scope or count: the phone learns which sentence to show and when it was true. The capture
   time is rounded down to the hour so a busy computer does not republish on every capture. */
export const remoteMemoryStatusSchema = z.object({ schema: z.literal("bottega.remote-memory/v1"), state: remoteMemoryStateSchema,
  issue: remoteMemoryIssueSchema.nullable(), since: time, lastCaptureAt: time.nullable().refine(value => value === null || value % HOUR === 0),
  publishedAt: time }).strict().refine(value => (value.state === "issue") === (value.issue !== null));
export type RemoteMemoryStatus = z.infer<typeof remoteMemoryStatusSchema>;
