/**
 * [INPUT]: Depends on Node guarded fs/crypto/path, shared Image dataURL/8MB compatible with canonical ChatAttachmentMeta
 * [OUTPUT]: Provides exportAttachmentFile: Source/Goal O_NOFOLLOW|O_NONBLOCK, MIME/length weighting, 0700/0600 and temporary file atomic arrays
 * [POS]: The chats attachment is exporting the security kernel; ChatsService exclusive attribution test, this file exclusive file system state machine with narrow fault seam injection
 */

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ATTACHMENT_BYTE_LIMIT,
  isValidImageDataUrl,
} from "../../../shared/agent-ipc";
import type { ChatAttachmentMeta } from "../../../shared/chats-ipc";

export type AttachmentExportDependencies = {
  writeTemp?: (path: string, content: Buffer) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
};

export async function exportAttachmentFile(input: {
  sourcePath: string;
  exportsRoot: string;
  attachmentId: string;
  meta: ChatAttachmentMeta;
  dependencies?: AttachmentExportDependencies;
}) {
  if (input.meta.byteSize > ATTACHMENT_BYTE_LIMIT) {
    throw statusError(413, "附件元数据超过 8 MB 上限");
  }
  const dataUrl = await readGuardedText(input.sourcePath, ENCODED_CAP);
  if (!isValidImageDataUrl(dataUrl)) throw new Error("附件内容已损坏");
  const comma = dataUrl.indexOf(",");
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(";", 5));
  if (asciiLower(mediaType) !== asciiLower(input.meta.mediaType)) {
    throw new Error("附件 MIME 与消息元数据不一致");
  }
  const content = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (content.byteLength !== input.meta.byteSize) {
    throw new Error("附件解码长度与消息元数据不一致");
  }
  await ensurePrivateDirectory(input.exportsRoot);
  const path = join(
    input.exportsRoot,
    `${input.attachmentId}.${extensionForMime(mediaType)}`
  );
  const existing = await readExistingTarget(path, content.byteLength);
  if (!existing || !existing.equals(content)) {
    await writeTarget(path, content, input.dependencies);
  }
  await chmod(path, 0o600);
  return {
    path,
    filename: input.meta.filename,
    media_type: input.meta.mediaType,
    bytes: content.byteLength,
  };
}

const ENCODED_CAP = Math.ceil(ATTACHMENT_BYTE_LIMIT / 3) * 4 + 256;
const guardedReadFlags =
  fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;

async function readGuardedText(path: string, byteLimit: number) {
  const handle = await open(path, guardedReadFlags);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("附件源必须是普通文件");
    if (info.size > byteLimit) throw statusError(413, "附件源编码体积超限");
    return handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("附件 exports 根必须是非 symlink 目录");
  }
  await chmod(root, 0o700);
}

async function readExistingTarget(path: string, expectedSize: number) {
  let handle;
  try {
    handle = await open(path, guardedReadFlags);
  } catch (cause) {
    if (isCode(cause, "ENOENT")) return null;
    throw cause;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("附件导出目标必须是普通文件");
    if (info.size !== expectedSize) return Buffer.alloc(0);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function writeTarget(
  path: string,
  content: Buffer,
  dependencies?: AttachmentExportDependencies
) {
  const temporary = `${path.slice(0, path.lastIndexOf("."))}.${randomUUID()}.tmp`;
  try {
    await (dependencies?.writeTemp ?? writePrivateTemp)(temporary, content);
    await (dependencies?.rename ?? rename)(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function writePrivateTemp(path: string, content: Buffer) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function extensionForMime(mediaType: string) {
  const known: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  return known[asciiLower(mediaType)] ?? "img";
}

const asciiLower = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

function isCode(cause: unknown, code: string) {
  return Boolean(
    cause && typeof cause === "object" && "code" in cause && cause.code === code
  );
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
