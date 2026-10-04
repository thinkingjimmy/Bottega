/**
 * [INPUT]: Depends on the shipped trust-source configuration, filesystem, native fetch contracts, signed metadata schemas and durable JSON persistence.
 * [OUTPUT]: Provides bounded metadata reads and authenticated-cache acceptance; an empty server snapshot is invalid and cannot replace durable revocations.
 * [POS]: Trust metadata acquisition only; verifier owns signatures, rotations, freshness and rollback decisions.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { rootDocumentSchema, snapshotDocumentSchema } from "@bottega/contracts/trust/signing";
import { digestCanonical } from "../../registry/registry-canonical";
import { durableReplaceFile } from "../../../persistence/durable-json";
import type { TrustAnchorRead } from "../anchor";

const MAX_BYTES = 2 * 1024 * 1024;
const metadataSchema = z.object({ roots: z.array(rootDocumentSchema).max(32), snapshot: snapshotDocumentSchema.nullable() }).strict();
type Metadata = { roots: readonly unknown[]; snapshot: unknown | null };
const empty: Metadata = { roots: [], snapshot: null };
const json = async (path: string) => {
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error("extension-trust-metadata-budget");
  return JSON.parse(bytes.toString("utf8")) as unknown;
};

function endpoint(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const source = z.object({ schema: z.literal("bottega.extension-trust-source/v1"), metadataUrl: z.string().url().max(2048).nullable() }).strict().parse(raw);
  if (!source.metadataUrl) return null;
  const url = new URL(source.metadataUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("extension-trust-source-invalid");
  return url.href;
}

export function trustMetadataSource(input: { anchor: TrustAnchorRead; userData: string; fetch?: typeof fetch; now?: () => number }) {
  const now = input.now ?? Date.now;
  let url: string | null = null, invalid = false;
  try { url = endpoint(input.anchor.metadataSource); } catch { invalid = true; }
  const identity = digestCanonical({ anchor: input.anchor.anchor, url });
  const directory = join(input.userData, "extension-trust"), path = join(directory, "metadata.json");
  let cached: Metadata | null = null, pending: Promise<Metadata> | null = null, loaded = false, last: Metadata = empty, nextFetch = 0;
  let writes = Promise.resolve();
  const read = async (): Promise<Metadata> => {
    if (input.anchor.source === "test-override" && input.anchor.directory) {
      try {
        const value = await json(join(input.anchor.directory, "metadata.json"));
        return metadataSchema.parse(value);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") return { roots: [], snapshot: { invalid: true } };
        try { return { roots: [], snapshot: await json(join(input.anchor.directory, "snapshot.json")) }; }
        catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? empty : { roots: [], snapshot: { invalid: true } }; }
      }
    }
    if (invalid) return { roots: [], snapshot: { invalid: true } };
    if (!url) return empty;
    if (!loaded) {
      loaded = true;
      try {
        const value = z.object({ identity: z.literal(identity), metadata: metadataSchema }).strict().parse(await json(path));
        cached = value.metadata;
      } catch { /* Cached bytes never authorize a package without a fresh verifier pass. */ }
    }
    if (now() < nextFetch) return last;
    nextFetch = now() + 60_000;
    try {
      // The standalone Node RequestInit omits cache; Request still defines its supported values.
      const options: RequestInit & Pick<Request, "cache"> = { redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(5000) };
      const response = await (input.fetch ?? fetch)(url, options);
      if (!response.ok || !response.body) throw new Error("extension-trust-source-unavailable");
      const length = Number(response.headers.get("content-length"));
      if (length > MAX_BYTES) { await response.body.cancel(); throw new Error("extension-trust-metadata-budget"); }
      const chunks: Uint8Array[] = [], reader = response.body.getReader();
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) throw new Error("extension-trust-metadata-budget");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const parsed = metadataSchema.safeParse(raw);
      last = parsed.success && parsed.data.snapshot !== null ? parsed.data
        : { roots: parsed.success ? parsed.data.roots : [], snapshot: { invalid: true } };
    } catch { last = cached ?? empty; nextFetch = now() + 10_000; }
    return last;
  };
  return {
    read() { return pending ??= read().finally(() => { pending = null; }); },
    async accept(metadata: Metadata) {
      if (!url || input.anchor.source === "test-override") return;
      const parsed = metadataSchema.parse(metadata);
      if (!parsed.snapshot) return;
      if (cached && digestCanonical(cached) === digestCanonical(parsed)) return;
      const content = `${JSON.stringify({ identity, metadata: parsed })}\n`;
      writes = writes.then(async () => { await mkdir(directory, { recursive: true }); await durableReplaceFile(path, content); cached = parsed; });
      await writes;
    },
  };
}
