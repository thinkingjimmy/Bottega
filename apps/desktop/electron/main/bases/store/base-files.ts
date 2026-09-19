/**
 * [INPUT]: Depends on Node fs/path, shared owner-aware Base/Gallery schema, and the commit-kernel durable write and errno guard; receives the v2 root plus optional read/write injections
 * [OUTPUT]: Owner-key generations, bounded ciphertext records, two-root family cleanup and read-only retained-sync enumeration; every dependency publishes before meta.
 * [POS]: The v2 file layout of bases/store borders on the IO; BaseStore only holds the status machine and submit order
 */

import { readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { BASE_META_BYTE_LIMIT, BASE_OWNER_KEY_PATTERN, BASE_ROW_LIMIT, BASE_ROWS_BYTE_LIMIT, type BaseMeta, type BaseRow } from "../../../../shared/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import {
  baseMetaSchema,
  baseRowSchema,
} from "../../../../shared/bases-schema";
import {
  BASE_GALLERY_LEDGER_BYTE_LIMIT,
  type BaseGalleryLedger,
} from "../../../../shared/bases/gallery-attachments";
import {
  BASE_HISTORY_LEDGER_BYTE_LIMIT,
  type BaseHistoryLedger,
} from "../../../../shared/bases/history-ledger-schema";
import { errorMessage } from "../../errors";
import { durableAtomicWrite, isErrnoCode } from "./commit-kernel";
import {
  emptyGalleryLedger,
  parseGalleryLedger,
} from "./gallery-ledger";
import { emptyHistoryLedger, parseHistoryLedger } from "./history-ledger";
import { BaseFolderPublication } from "./folder/publication";

const bytes = (value: string) => Buffer.byteLength(value, "utf8");

type BaseFileOptions = {
  syncRoot?: string;
  folderCheckpoint?: (phase: "intent" | "content" | "commit") => Promise<void>;
  readText?: (path: string) => Promise<string>;
  atomicWrite?: (path: string, content: string) => Promise<void>;
};

export class BaseStoreFiles {
  readonly folder: BaseFolderPublication | null;
  get root() { return typeof this.location === "string" ? this.location : this.location(); }
  get syncRoot() { return this.options.syncRoot ?? this.root; }
  private readonly readText: (path: string) => Promise<string>;

  constructor(
    private readonly location: string | (() => string),
    private readonly options: BaseFileOptions = {}
  ) {
    this.folder = options.syncRoot ? new BaseFolderPublication(options.syncRoot, options.folderCheckpoint) : null;
    this.readText =
      options.readText ?? ((path) => readFile(path, "utf8"));
  }

  serializeMeta(meta: BaseMeta) {
    const content = `${JSON.stringify(meta, null, 2)}\n`;
    if (bytes(content) > BASE_META_BYTE_LIMIT) {
      throw new Error("Base meta 超过 1 MiB");
    }
    return content;
  }

  serializeRows(rows: BaseRow[]) {
    const content = `${JSON.stringify(rows)}\n`;
    if (bytes(content) > BASE_ROWS_BYTE_LIMIT) {
      throw new Error("Base rows 超过 20 MiB");
    }
    return content;
  }

  async rowsBytes(meta: BaseMeta) {
    const bytes = (await stat(
      this.rowsPath(ownerKeyOf(meta.owner), meta.rowsGeneration)
    )).size;
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > BASE_ROWS_BYTE_LIMIT) {
      throw new Error("Base rows durable byte identity is invalid");
    }
    return bytes;
  }

  serializeGallery(gallery: BaseGalleryLedger) {
    const content = `${JSON.stringify(gallery)}\n`;
    if (bytes(content) > BASE_GALLERY_LEDGER_BYTE_LIMIT) {
      throw new Error("Gallery ledger 超过 2 MiB");
    }
    return content;
  }

  serializeHistory(history: BaseHistoryLedger) {
    const content = `${JSON.stringify(history)}\n`;
    if (bytes(content) > BASE_HISTORY_LEDGER_BYTE_LIMIT) {
      throw new Error("Base history ledger 超过 2 MiB");
    }
    return content;
  }

  async readRows(meta: BaseMeta) {
    let content: string;
    try {
      content = await this.readBounded(
        this.rowsPath(ownerKeyOf(meta.owner), meta.rowsGeneration),
        BASE_ROWS_BYTE_LIMIT
      );
    } catch (cause) {
      if (isErrnoCode(cause, "ENOENT")) {
        throw new Error(
          `meta 引用的 rows 世代 ${meta.rowsGeneration} 不存在`
        );
      }
      throw cause;
    }
    const raw = JSON.parse(content) as unknown;
    if (!Array.isArray(raw) || raw.length > BASE_ROW_LIMIT) {
      throw new Error("Base rows 结构或行数无效");
    }
    return raw.map((row) => baseRowSchema.parse(row));
  }

  async readGallery(meta: BaseMeta) {
    const generation = meta.galleryGeneration;
    try {
      const content = await this.readBounded(
        this.galleryPath(ownerKeyOf(meta.owner), generation),
        BASE_GALLERY_LEDGER_BYTE_LIMIT
      );
      return parseGalleryLedger(
        JSON.parse(content),
        galleryOwnerId(meta),
        meta.ownerInstanceId
      );
    } catch (cause) {
      if (generation === 0 && isErrnoCode(cause, "ENOENT")) {
        return emptyGalleryLedger(galleryOwnerId(meta), meta.ownerInstanceId);
      }
      throw new Error(
        `meta 引用的 Gallery 世代 ${generation} 无效：${errorMessage(cause)}`
      );
    }
  }

  async readHistory(meta: BaseMeta) {
    const generation = meta.historyGeneration;
    try {
      const content = await this.readBounded(
        this.historyPath(ownerKeyOf(meta.owner), generation),
        BASE_HISTORY_LEDGER_BYTE_LIMIT
      );
      return parseHistoryLedger(JSON.parse(content));
    } catch (cause) {
      if (generation === 0 && isErrnoCode(cause, "ENOENT")) {
        return emptyHistoryLedger();
      }
      throw new Error(
        `meta 引用的 History 世代 ${generation} 无效：${errorMessage(cause)}`
      );
    }
  }

  async readMetaIfPresent(ownerKey: string) {
    try {
      const raw = JSON.parse(
          await this.readBounded(
            this.metaPath(ownerKey),
            BASE_META_BYTE_LIMIT
          ));
      return this.folder ? this.folder.read(raw) : baseMetaSchema.parse(raw);
    } catch (cause) {
      if (isErrnoCode(cause, "ENOENT")) return null;
      throw cause;
    }
  }

  async readBounded(path: string, limit: number) {
    const value = await this.readText(path);
    if (bytes(value) > limit) {
      throw new Error(`${basename(path)} 文件体积超限`);
    }
    return value;
  }

  metaPath(ownerKey: string) {
    return join(this.root, `${ownerFileStem(ownerKey)}.json`);
  }

  rowsPath(ownerKey: string, generation: number) {
    return join(this.root, `${ownerFileStem(ownerKey)}.rows.${generation}.json`);
  }

  galleryPath(ownerKey: string, generation: number) {
    return join(
      this.root,
      `${ownerFileStem(ownerKey)}.gallery.${generation}.json`
    );
  }

  historyPath(ownerKey: string, generation: number) {
    return join(
      this.root,
      `${ownerFileStem(ownerKey)}.history.${generation}.json`
    );
  }

  async atomicWrite(path: string, content: string) {
    // Comparing directories keeps the folder publication on every platform; a literal "/" silently skipped it on Windows.
    if (this.folder && dirname(path) === this.root && /^(?:chat|project)-[A-Za-z0-9_-]{1,128}\.json$/.test(basename(path))) {
      return this.folder.write(path, baseMetaSchema.parse(JSON.parse(content)), (target, text) => durableAtomicWrite(target, text, this.options.atomicWrite));
    }
    await durableAtomicWrite(path, content, this.options.atomicWrite);
  }
  private ciphertextPath(ownerKey: string, hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("BASE_CIPHERTEXT_IDENTITY_CHANGED");
    return join(this.syncRoot, `${ownerFileStem(ownerKey)}.cipher.${hash}.json`);
  }
  async readCiphertext(ownerKey: string, hash: string) {
    const content = await this.readBounded(this.ciphertextPath(ownerKey, hash), 3 * 1024 * 1024);
    if (createHash("sha256").update(content).digest("hex") !== hash) throw new Error("BASE_CIPHERTEXT_IDENTITY_CHANGED");
    return JSON.parse(content) as unknown;
  }
  async writeCiphertext(ownerKey: string, content: string) {
    if (Buffer.byteLength(content) > 3 * 1024 * 1024) throw new Error("BASE_CIPHERTEXT_RECORD_TOO_LARGE");
    const hash = createHash("sha256").update(content).digest("hex");
    await this.atomicWrite(this.ciphertextPath(ownerKey, hash), content); return hash;
  }
  async gcCiphertext(ownerKey: string, hashes: ReadonlySet<string>) {
    const prefix = `${ownerFileStem(ownerKey)}.cipher.`;
    for (const entry of await readdir(this.syncRoot, { withFileTypes: true })) if (entry.isFile() && entry.name.startsWith(prefix)) {
      const hash = /^([a-f0-9]{64})\.json$/.exec(entry.name.slice(prefix.length))?.[1];
      if (hash && !hashes.has(hash)) await rm(join(this.syncRoot, entry.name), { force: true });
    }
  }
  async copyCiphertext(fromOwner: string, toOwner: string, hashes: ReadonlySet<string>) {
    for (const hash of hashes) {
      const value = await this.readCiphertext(fromOwner, hash);
      const written = await this.writeCiphertext(toOwner, `${JSON.stringify(value)}\n`);
      if (written !== hash) throw new Error("BASE_CIPHERTEXT_IDENTITY_CHANGED");
    }
  }
  async retainedSyncGenerations(ownerKey: string) {
    const prefix = `${ownerFileStem(ownerKey)}.sync.`, generations: number[] = [];
    for (const entry of await readdir(this.syncRoot, { withFileTypes: true })) if (entry.isFile() && entry.name.startsWith(prefix)) {
      const raw = /^(0|[1-9][0-9]*)\.json$/.exec(entry.name.slice(prefix.length))?.[1];
      if (raw) { const value = Number(raw); if (!Number.isSafeInteger(value)) throw new Error("BASE_SYNC_GENERATION_INVALID"); generations.push(value); }
    }
    return generations;
  }

  /** 清理 durableAtomicWrite 崩溃遗留的 `*.tmp`；仅在 initialize 串行窗口调用。 */
  async sweepTemporaryFiles() {
    await Promise.all(this.familyRoots.map(async (directory) => {
      const names = await this.familyNames(directory, /\.tmp$/);
      await Promise.all(names.map((name) =>
        rm(join(directory, name), { force: true }).catch(() =>
          console.warn(`Base tmp 清理失败：${name}`)
        )
      ));
    }));
  }

  /* Content and synchronization state are two directories since the split; every family scan must
     visit both or deletion leaves envelopes, ciphertext and pointers behind in the profile. */
  private get familyRoots() {
    return this.syncRoot === this.root ? [this.root] : [this.root, this.syncRoot];
  }

  private async familyNames(directory: string, pattern: RegExp) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((cause) => {
      if (isErrnoCode(cause, "ENOENT")) return [];
      throw cause;
    });
    return entries.filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => entry.name);
  }

  async gcGenerations(
    ownerKey: string,
    currentRows: number,
    currentGallery: number,
    currentHistory: number,
    currentSync?: number
  ) {
    const pattern = new RegExp(
      `^${escapePattern(ownerFileStem(ownerKey))}\\.(rows|gallery|history|sync)\\.(\\d+)\\.json$`
    );
    await Promise.all(this.familyRoots.map(async (directory) => {
      const names = await this.familyNames(directory, pattern);
      await Promise.all(names.flatMap((name) => {
        const match = pattern.exec(name)!;
        const generation = Number(match[2]);
        const current = match[1] === "sync" ? currentSync :
          match[1] === "gallery"
            ? currentGallery
            : match[1] === "history"
              ? currentHistory
              : currentRows;
        if (generation === current || generation === (current ?? 0) - 1) return [];
        return [rm(join(directory, name), { force: true })];
      }));
    }));
  }

  async removeFamilyFiles(ownerKey: string) {
    const pattern = familyPattern(ownerFileStem(ownerKey));
    await Promise.all(this.familyRoots.map(async (directory) => {
      const names = await this.familyNames(directory, pattern);
      await Promise.all(names.map((name) => rm(join(directory, name), { force: true })));
    }));
  }
}

/** Every durable file of one owner: content generations plus the profile-side envelopes, ciphertext and pointer. */
function familyPattern(stem: string) {
  return new RegExp(
    `^${escapePattern(stem)}(?:\\.json|\\.local\\.json(?:\\.intent)?|\\.(?:rows|gallery|history|sync)\\.\\d+\\.json|\\.cipher\\.[a-f0-9]{64}\\.json)$`
  );
}

export function ownerFileStem(ownerKey: string) {
  if (!BASE_OWNER_KEY_PATTERN.test(ownerKey)) {
    throw new Error("Base ownerKey 格式无效");
  }
  return ownerKey.replace(":", "-");
}

export function ownerKeyFromStem(stem: string) {
  const match = /^(chat|project)-([A-Za-z0-9_-]{1,128})$/.exec(stem);
  if (!match) throw new Error("Base v2 文件名无效");
  return `${match[1]}:${match[2]}`;
}

/** Gallery ledger 的 owner 投影唯一真相：chat 直用 chatId，project 用 v2 文件 stem。 */
export function galleryOwnerId(meta: BaseMeta) {
  return meta.owner.kind === "chat"
    ? meta.owner.chatId
    : ownerFileStem(ownerKeyOf(meta.owner));
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
