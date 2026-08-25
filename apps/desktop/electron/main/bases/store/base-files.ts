/**
 * [INPUT]: Depends on Node fs/path, shared owner-aware Base/Gallery schema and durableAtomicWrite; Receive v2 root, read/write input and warning/error plants
 * [OUTPUT]: Provides ownerKey→v2 File name, Base meta/rows/gallery bounded IO, generation GC, unknown Save and family of files
 * [POS]: The v2 file layout of bases/store borders on the IO; BaseStore only holds the status machine and submit order
 */

import { copyFile, readFile, readdir, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import {
  BASE_META_BYTE_LIMIT,
  BASE_OWNER_KEY_PATTERN,
  BASE_ROW_LIMIT,
  BASE_ROWS_BYTE_LIMIT,
  type BaseMeta,
  type BaseRow,
  ownerKeyOf,
} from "../../../../shared/bases-ipc";
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
import { durableAtomicWrite } from "./commit-kernel";
import {
  emptyGalleryLedger,
  parseGalleryLedger,
} from "./gallery-ledger";
import { emptyHistoryLedger, parseHistoryLedger } from "./history-ledger";

const bytes = (value: string) => Buffer.byteLength(value, "utf8");

type BaseFileOptions = {
  readText?: (path: string) => Promise<string>;
  atomicWrite?: (path: string, content: string) => Promise<void>;
  corrupt(message: string): Error;
  warn(message: string): void;
};

export class BaseStoreFiles {
  private readonly readText: (path: string) => Promise<string>;

  constructor(
    private readonly root: string,
    private readonly options: BaseFileOptions
  ) {
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
      if (isCode(cause, "ENOENT")) {
        throw this.options.corrupt(
          `meta 引用的 rows 世代 ${meta.rowsGeneration} 不存在`
        );
      }
      throw cause;
    }
    const raw = JSON.parse(content) as unknown;
    if (!Array.isArray(raw) || raw.length > BASE_ROW_LIMIT) {
      throw this.options.corrupt("Base rows 结构或行数无效");
    }
    return raw.map((row) => baseRowSchema.parse(row));
  }

  async readGallery(meta: BaseMeta) {
    const generation = meta.galleryGeneration ?? 0;
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
      if (generation === 0 && isCode(cause, "ENOENT")) {
        return emptyGalleryLedger(galleryOwnerId(meta), meta.ownerInstanceId);
      }
      throw this.options.corrupt(
        `meta 引用的 Gallery 世代 ${generation} 无效：${errorMessage(cause)}`
      );
    }
  }

  async readHistory(meta: BaseMeta) {
    const generation = meta.historyGeneration ?? 0;
    try {
      const content = await this.readBounded(
        this.historyPath(ownerKeyOf(meta.owner), generation),
        BASE_HISTORY_LEDGER_BYTE_LIMIT
      );
      return parseHistoryLedger(JSON.parse(content));
    } catch (cause) {
      if (generation === 0 && isCode(cause, "ENOENT")) {
        return emptyHistoryLedger();
      }
      throw this.options.corrupt(
        `meta 引用的 History 世代 ${generation} 无效：${errorMessage(cause)}`
      );
    }
  }

  async readLegacyGalleryTarget(ownerKey: string, generation: number) {
    try {
      const raw = JSON.parse(
        await this.readBounded(
          this.galleryPath(ownerKey, generation),
          BASE_GALLERY_LEDGER_BYTE_LIMIT
        )
      ) as { targetColumnId?: unknown };
      return typeof raw.targetColumnId === "string"
        ? raw.targetColumnId
        : undefined;
    } catch (cause) {
      if (generation === 0 && isCode(cause, "ENOENT")) return undefined;
      throw cause;
    }
  }

  async readMetaIfPresent(ownerKey: string) {
    try {
      return baseMetaSchema.parse(
        JSON.parse(
          await this.readBounded(
            this.metaPath(ownerKey),
            BASE_META_BYTE_LIMIT
          )
        )
      );
    } catch (cause) {
      if (isCode(cause, "ENOENT")) return null;
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

  corruptPath(ownerKey: string) {
    return join(this.root, `${ownerFileStem(ownerKey)}.corrupt.json`);
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
    await durableAtomicWrite(path, content, {
      write: this.options.atomicWrite,
    });
  }

  async backupBeforeRowGalleryMigration(ownerKey: string, meta: BaseMeta) {
    const sources = [
      this.metaPath(ownerKey),
      this.rowsPath(ownerKey, meta.rowsGeneration),
      this.galleryPath(ownerKey, meta.galleryGeneration ?? 0),
    ];
    await Promise.all(sources.map(async (source) => {
      await copyFile(
        source,
        `${source}.pre-row-gallery.bak`,
        constants.COPYFILE_EXCL
      ).catch((cause) => {
        if (isCode(cause, "EEXIST")) return;
        if (source.includes(".gallery.") && isCode(cause, "ENOENT")) return;
        throw cause;
      });
    }));
  }

  /** 清理 durableAtomicWrite 崩溃遗留的 `*.tmp`；仅在 initialize 串行窗口调用。 */
  async sweepTemporaryFiles() {
    const entries = await readdir(this.root, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".tmp"))
        .map((entry) =>
          rm(join(this.root, entry.name), { force: true }).catch(() =>
            this.options.warn(`Base tmp 清理失败：${entry.name}`)
          )
        )
    );
  }

  async gcGenerations(
    ownerKey: string,
    currentRows: number,
    currentGallery: number,
    currentHistory = 0
  ) {
    const entries = await readdir(this.root, { withFileTypes: true });
    const pattern = new RegExp(
      `^${escapePattern(ownerFileStem(ownerKey))}\\.(rows|gallery|history)\\.(\\d+)\\.json$`
    );
    await Promise.all(
      entries.flatMap((entry) => {
        const match = entry.isFile() ? pattern.exec(entry.name) : null;
        const generation = match ? Number(match[2]) : -1;
        const current =
          match?.[1] === "gallery"
            ? currentGallery
            : match?.[1] === "history"
              ? currentHistory
              : currentRows;
        if (
          !match ||
          generation === current ||
          generation === current - 1
        ) {
          return [];
        }
        return [rm(join(this.root, entry.name), { force: true })];
      })
    );
  }

  async retainUnownedGenerations(metaIds: ReadonlySet<string>) {
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      const match =
        /^((?:chat|project)-[A-Za-z0-9_-]{1,128})\.(?:rows|gallery|history)\.\d+\.json$/.exec(
          entry.name
        );
      if (!entry.isFile() || !match || metaIds.has(match[1]!)) continue;
      this.options.warn(
        `Base 世代 ${entry.name} 缺少可验证所有者，按 unknown 保留`
      );
    }
  }

  async removeFamilyFiles(ownerKey: string) {
    const entries = await readdir(this.root, { withFileTypes: true });
    const pattern = new RegExp(
      `^${escapePattern(ownerFileStem(ownerKey))}(?:\\.json(?:\\.bak-\\d+|\\.pre-row-gallery\\.bak)?|\\.corrupt\\.json|\\.(?:rows|gallery|history)\\.\\d+\\.json(?:\\.pre-row-gallery\\.bak)?)$`
    );
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && pattern.test(entry.name))
        .map((entry) =>
          rm(join(this.root, entry.name), { force: true })
        )
    );
  }

  async isolateFamily(ownerKey: string, timestamp: number) {
    const entries = await readdir(this.root, { withFileTypes: true });
    const stem = ownerFileStem(ownerKey);
    const pattern = new RegExp(
      `^${escapePattern(stem)}(?:\\.json(?:\\.bak-\\d+|\\.pre-row-gallery\\.bak)?|\\.corrupt\\.json|\\.(?:rows|gallery|history)\\.\\d+\\.json(?:\\.pre-row-gallery\\.bak)?)$`
    );
    for (const entry of entries) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      await rename(
        join(this.root, entry.name),
        join(this.root, `${entry.name}.orphan-${timestamp}`)
      );
    }
  }
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

function isCode(cause: unknown, code: string) {
  return (cause as { code?: string })?.code === code;
}
