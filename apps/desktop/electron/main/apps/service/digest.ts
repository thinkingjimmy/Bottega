/**
 * [INPUT]: Depends on Node crypto and JSON-sequenced field values
 * [OUTPUT]: AppDigest is provided for the app, generating App durable identity Shared sha256 abstract
 * [POS]: The only source of pure function for apps/services; Turn snapshots and delete archive in common, avoiding two identity algorithms
 */

import { createHash } from "node:crypto";

export function appDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}
