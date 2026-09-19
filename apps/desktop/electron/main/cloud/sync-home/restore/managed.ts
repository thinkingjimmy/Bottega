/**
 * [INPUT]: Trusted profile directory, account/Home identity and verified portable manifest paths.
 * [OUTPUT]: Durable managed-path inventory plus the folded retention/removal decisions shared by capture and restore; unknown local files never become deletion candidates.
 * [POS]: Local ownership evidence outside the synchronized Home, scoped by account, incarnation and Home intent.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { homePathSchema, MAX_HOME_ENTRIES, type HomeEntry } from "@ai-chat/cloud-protocol/chats/home/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { durableReplaceFile } from "../../../persistence/durable-json";
const schema = z.array(homePathSchema).max(MAX_HOME_ENTRIES * 2);
/* Only Linux distinguishes case and Unicode form in the same directory; everywhere else two spellings
   name one file, so managed paths must be compared folded or a retained file becomes a deletion. */
export const managedPathKey = (path: string) => process.platform === "linux" ? path : path.normalize("NFC").toLowerCase();
/** Paths a snapshot keeps managed: every file it carries, plus omitted entries this profile already owns. */
export function retainedManagedPaths(previous: readonly string[], entries: readonly HomeEntry[]) {
  const owned = new Set(previous.map(managedPathKey));
  return entries.filter(entry => entry.kind === "file" || owned.has(managedPathKey(entry.path))).map(entry => entry.path);
}
/** Managed paths this snapshot drops, deepest first so directories empty before they are pruned. */
export function removedManagedPaths(previous: readonly string[], next: readonly string[]) {
  const retained = new Set(next.map(managedPathKey));
  return previous.filter(path => !retained.has(managedPathKey(path))).sort((a, b) => b.split("/").length - a.split("/").length);
}
export class ManagedHomeFiles {
  private readonly path: string;
  constructor(userData: string, identity: unknown) { this.path = join(userData, "chat-home-sources", `.managed-${hashChatContent(identity)}.json`); }
  async read(): Promise<string[]> {
    const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error;
    });
    if (!file) return [];
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024) throw new Error("HOME_MANAGED_PATHS_INVALID");
      return schema.parse(JSON.parse(await file.readFile("utf8")));
    } finally { await file.close(); }
  }
  async write(paths: readonly string[]) { await durableReplaceFile(this.path, JSON.stringify(schema.parse([...new Set(paths)].sort()))); }
}
