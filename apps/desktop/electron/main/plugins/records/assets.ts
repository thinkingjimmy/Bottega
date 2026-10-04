/**
 * [INPUT]: Depends on package budgets, canonical package digests and Node filesystem/crypto.
 * [OUTPUT]: Provides readRecordAssets: immutable UI bytes verified as part of one exact package snapshot.
 * [POS]: Record Surface content boundary; no second path-based read can replace verified bytes.
 */
import { constants } from "node:fs";
import { open, opendir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { digestCanonical } from "../../extensions/registry/registry-canonical";
import { EXTENSION_PACKAGE_BUDGET as LIMIT } from "../../extensions/install/source";

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
export async function readRecordAssets(root: string, entry: string, expected: string) {
  const prefix = dirname(entry) === "." ? "" : `${dirname(entry)}/`;
  const snapshot: { path: string; bytes: number; digest: string }[] = [];
  const files: { path: string; mime: string; bytes: number; sha256: string; read(): Promise<Uint8Array> }[] = [];
  let total = 0;
  async function walk(relative = "", depth = 0) {
    if (depth > LIMIT.depth) throw new Error("plugin-ui-budget");
    const directory = await opendir(join(root, relative));
    for await (const item of directory) {
      const path = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) { await walk(path, depth + 1); continue; }
      if (!item.isFile() || snapshot.length >= LIMIT.files) throw new Error("plugin-ui-file-invalid");
      const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
      let content: Buffer;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > LIMIT.fileBytes || total + stat.size > LIMIT.totalBytes) throw new Error("plugin-ui-budget");
        const bounded = Buffer.alloc(LIMIT.fileBytes + 1);
        let size = 0;
        while (size < bounded.length) {
          const read = await handle.read(bounded, size, bounded.length - size, null);
          if (!read.bytesRead) break;
          size += read.bytesRead;
        }
        if (size > LIMIT.fileBytes || total + size > LIMIT.totalBytes) throw new Error("plugin-ui-budget");
        content = bounded.subarray(0, size); total += size;
      } finally { await handle.close(); }
      snapshot.push({ path, bytes: content.length, digest: digestCanonical(content.toString("base64")) });
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length), mime = MIME[extname(name)];
      if (!mime) continue;
      const bytes = new Uint8Array(content);
      files.push({ path: name, mime, bytes: bytes.length, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, read: async () => bytes });
    }
  }
  await walk();
  snapshot.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (digestCanonical(snapshot) !== expected) throw new Error("plugin-content-changed");
  if (!files.some(file => file.path === "index.html")) throw new Error("plugin-ui-entry-invalid");
  return files;
}
