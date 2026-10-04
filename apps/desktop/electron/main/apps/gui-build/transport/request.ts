/**
 * [INPUT]: Depends on bounded Node byte streams and zod; owns no process or filesystem authority
 * [OUTPUT]: Provides the versioned compiler request schema and one-frame UTF-8 stdin transport
 * [POS]: Shared Host/compiler transport including readable executable controls; native policies wrap the same request
 */

import { TextDecoder } from "node:util";
import { z } from "zod";

export const COMPILER_REQUEST_SCHEMA = "bottega.compiler-request/v1";
export const COMPILER_REQUEST_BYTES = 1024 * 1024;
const path = z.string().min(1).max(32_768).refine((value) => !value.includes("\0"));
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`);
const version = { schema: z.literal(COMPILER_REQUEST_SCHEMA) };

export const compilerRequestSchema = z.discriminatedUnion("mode", [
  z.object({ ...version, mode: z.literal("compile"), input: z.object({
    snapshotRoot: path, outputRoot: path, tempRoot: path,
    sourcePackageDigest: digest, transformContractDigest: digest, platformCompilerCustodyDigest: digest,
  }).strict() }).strict(),
  z.object({ ...version, mode: z.literal("probe"), forbiddenRead: path, forbiddenWrite: path,
    loopbackPort: z.number().int().min(1).max(65_535), spawnExecutable: path, readableExecutable: path }).strict(),
  z.object({ ...version, mode: z.literal("custody-probe"), processCount: z.number().int().min(1).max(4) }).strict(),
  z.object({ ...version, mode: z.literal("resource-probe"), kind: z.enum(["rss", "cpu", "timeout"]) }).strict(),
]);

export type CompilerRequest = z.infer<typeof compilerRequestSchema>;

export function encodeJsonFrame(value: unknown, maximum = COMPILER_REQUEST_BYTES): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (!payload.length || payload.length > maximum) throw protocolError("request exceeds the byte budget");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

export function encodeCompilerRequest(request: CompilerRequest): Buffer {
  return encodeJsonFrame(compilerRequestSchema.parse(request));
}

async function readJsonFrame(stream: AsyncIterable<Uint8Array>, maximum = COMPILER_REQUEST_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let expected: number | null = null;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > maximum + 4) throw protocolError("request exceeds the byte budget");
    chunks.push(Buffer.from(chunk));
    if (expected === null && bytes >= 4) {
      expected = Buffer.concat(chunks, bytes).readUInt32BE(0);
      if (!expected || expected > maximum) throw protocolError("invalid frame length");
    }
    if (expected !== null && bytes > expected + 4) throw protocolError("trailing request bytes");
  }
  if (expected === null || bytes !== expected + 4) throw protocolError("incomplete request");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes).subarray(4)));
  } catch {
    throw protocolError("invalid UTF-8 JSON");
  }
}

export async function readCompilerRequest(stream: AsyncIterable<Uint8Array>): Promise<CompilerRequest> {
  const value = compilerRequestSchema.safeParse(await readJsonFrame(stream));
  if (!value.success) throw protocolError("invalid compiler request schema");
  return value.data;
}

function protocolError(message: string) {
  return Object.assign(new Error(`Compiler transport: ${message}`), { code: "GUI_COMPILER_PROTOCOL_INVALID" });
}
