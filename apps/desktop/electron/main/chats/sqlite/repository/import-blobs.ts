/**
 * [INPUT]: Depends on crypto/fs/path and the SQLite blob reference tables
 * [OUTPUT]: Provides ImportBlobStore: content-addressed publication of oversized imported content with an identity check on every existing file, plus best-effort unlinking
 * [POS]: The filesystem half of HistoryImportRepository; nothing above it knows a blob is a file
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SqliteDatabase } from "../connection";
import { digest } from "./codec";

/* 超过阈值的导入正文不进 chunk 表，进一个以内容摘要命名的文件。同一份内容
   写第二次时不重写，只核对现场那个文件确实还是它自称的那份内容——名字是
   身份，名字对不上就是别人的东西。 */
export class ImportBlobStore {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => number,
    private readonly root?: string
  ) {}

  write(entryVersionId: string, content: string) {
    if (!this.root) throw new Error("Oversized history content has no blob root");
    const bytes = Buffer.from(content, "utf8");
    const contentDigest = digest(bytes);
    const path = this.publish(contentDigest, bytes);
    this.database.prepare(
      `INSERT INTO chat_import_blobs(content_digest, byte_size, local_path, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(content_digest) DO NOTHING`
    ).run(contentDigest, bytes.length, path, this.now());
    this.database.prepare(
      `INSERT INTO chat_import_entry_blobs(entry_version_id, field_kind, content_digest)
       VALUES (?, 'content', ?)`
    ).run(entryVersionId, contentDigest);
  }

  unlink(contentDigests: readonly string[]) {
    if (!this.root) return;
    for (const contentDigest of contentDigests) {
      try { unlinkSync(join(this.root, contentDigest)); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
  }

  private publish(contentDigest: string, bytes: Buffer) {
    const root = this.root!;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const destination = join(root, contentDigest);
    try {
      const existing = lstatSync(destination);
      if (!existing.isFile() || existing.isSymbolicLink() || digest(readFileSync(destination)) !== contentDigest) {
        throw new Error("Existing history blob does not match its content identity");
      }
      return destination;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    const temporary = join(root, `.blob-${randomUUID()}`);
    const file = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      writeFileSync(file, bytes);
      fsyncSync(file);
    } finally { closeSync(file); }
    try { linkSync(temporary, destination); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    } finally { unlinkSync(temporary); }
    const published = lstatSync(destination);
    if (
      !published.isFile() || published.isSymbolicLink() ||
      published.size !== bytes.length || digest(readFileSync(destination)) !== contentDigest
    ) throw new Error("Published history blob does not match its content identity");
    const directory = openSync(root, constants.O_RDONLY);
    try { fsyncSync(directory); }
    finally { closeSync(directory); }
    return destination;
  }
}
