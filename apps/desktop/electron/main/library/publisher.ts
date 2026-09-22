/**
 * [INPUT]: Depends on Node fs, Zod and durable file replacement.
 * [OUTPUT]: Provides readPublisher / writePublisher over `<folder>/.bottega/publisher.json`, the marker that names the computer a Bottega folder was published from.
 * [POS]: A sibling of `library.json` and deliberately outside the folder identity: it is never hashed, never uploaded and absent means "never published".
 */
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { durableReplaceFile } from "../persistence/durable-json";

// Another build's extra fields belong to whoever wrote them; only the three this one understands are replaced.
export const publisherSchema = z.object({ version: z.literal(1), machineIdHash: z.string().regex(/^[a-f0-9]{64}$/),
  deviceId: z.string().min(1).max(128), host: z.string().min(1).max(255), publishedAt: z.number().int().nonnegative() }).catchall(z.unknown());
export type FolderPublisher = z.infer<typeof publisherSchema>;
export const publisherPath = (root: string) => join(root, ".bottega", "publisher.json");

/** An absent, unreadable or malformed marker all mean the same thing: this folder has never been published. */
export async function readPublisher(root: string): Promise<FolderPublisher | null> {
  try {
    const path = publisherPath(root), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) return null;
    return publisherSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch { return null; }
}

/** Written after the first successful library publication, and again whenever ownership moves to this installation. */
export async function writePublisher(root: string, value: Omit<FolderPublisher, "version">) {
  const current = await readPublisher(root);
  if (current && current.machineIdHash === value.machineIdHash && current.deviceId === value.deviceId &&
    current.host === value.host && current.publishedAt === value.publishedAt) return;
  const next = { ...current, ...value, version: 1 as const };
  await durableReplaceFile(publisherPath(root), JSON.stringify(next, null, 2) + "\n");
}
