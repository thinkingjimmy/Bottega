/**
 * [INPUT]: Zod and unsupported manifest metadata classification.
 * [OUTPUT]: storedArtifactFenceSchema and unsupportedArtifactFence separate retained identities from executable current fences.
 * [POS]: Shared ledger preservation boundary; it never parses or converts retired design content.
 */
import { z } from "zod";
import { unsupportedDesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/core/retained";
export const storedArtifactFenceSchema = z.object({ v: z.literal(1), id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  kind: z.string().min(1).max(128), title: z.string().min(1).max(250) }).passthrough();
export function unsupportedArtifactFence(value: { kind: string; design?: unknown }) {
  return value.kind === "design" && unsupportedDesignManifest(value.design);
}
