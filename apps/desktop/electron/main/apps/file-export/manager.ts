/**
 * [INPUT]: Depends on native destination selection, durable exact-path intents, Node file/hash custody, node:util's TextDecoder, active surface binding, and side-effect lifecycle ports
 * [OUTPUT]: Provides begin/write/finalize/cancel/surface-close/crash-recovery for file.export V1 with atomic dialog-slot admission, one-unacknowledged-chunk backpressure, streaming content validation, and 20 MiB integrity limits
 * [POS]: file-export Host authority; App runtimes never receive destination paths or reusable file handles
 */

import { createHash, randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
/* TextDecoder 显式取自 node:util：主进程编译不含 DOM lib，私有树里它能当
   类型用只是 @types/jsdom 顺手带进来的副作用，公开树没有这层运气。 */
import { TextDecoder } from "node:util";
import type { FileHandle } from "node:fs/promises";
import {
  beginFileExportRequestV1Schema,
  FILE_EXPORT_SUFFIX,
  writeFileExportChunkHeaderV1Schema,
  type BeginFileExportRequestV1,
  type BeginFileExportResultV1,
  type CompleteFileExportResultV1,
  type WriteFileExportChunkHeaderV1,
} from "../../../../shared/app-gui/file-export";
import type { GuiSideEffectPermit } from "../gui-cutover/side-effects";
import { FileExportIntentStore, isFileExportBusy } from "./intent-store";

const MAX_LIFETIME_MS = 60_000;
const IDLE_TIMEOUT_MS = 15_000;
const MAX_GLOBAL = 4;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/* 曾经这里有 logicalSurfaceId 与 leaseId 两个字段，装配处把同一个
   appSurfaceLeaseId 用非空断言填进去两次——两个名字、一份事实、零校验。
   decisionId 与 cutoverRevision 是同一种病的第二季：写进来、从不比对，
   README 却宣称会话被它们绑住。会话真正的代际闸门是 side-effect permit
   （随 cutover 关闭准入、drain、按面取消），surface 身份则由 assertSurface
   逐次核对。留一个没人读的字段，只会让下一个人以为它在守护什么。 */
type FileExportBinding = Readonly<{
  appId: string;
  generationId: string;
  surfaceLeaseId: string;
  runtimeSurfaceId: string;
}>;

/* 校验载荷不能靠攒下整份文件：20 MiB 的 text/* 会先被 concat 复制一份，再
   解成一个同样大的字符串。UTF-8 是流式可判定的，逐块喂给同一个 fatal 解码
   器即可；只有 JSON 必须看到全文才能 parse。 */
type Validation =
  | Readonly<{ kind: "utf8"; decoder: TextDecoder }>
  | Readonly<{ kind: "json"; chunks: Buffer[] }>
  | Readonly<{ kind: "signature" }>;

type Session = {
  exportId: string;
  binding: FileExportBinding;
  request: BeginFileExportRequestV1;
  permit: GuiSideEffectPermit;
  destinationPath: string;
  partialPath: string;
  file: FileHandle;
  hash: ReturnType<typeof createHash>;
  bytes: number;
  seq: number;
  firstBytes: Buffer;
  validation: Validation;
  startedAt: number;
  touchedAt: number;
  timer: NodeJS.Timeout;
  serial: Promise<void>;
  chunkPending: boolean;
  terminal: boolean;
};

type FileExportPorts = Readonly<{
  chooseDestination(input: { suggestedName: string; mediaType: string }): Promise<string | null>;
  startPermit(permit: GuiSideEffectPermit): void;
  completePermit(permit: GuiSideEffectPermit, result: CompleteFileExportResultV1): void;
  audit(event: Readonly<{
    appId: string;
    generationId: string;
    surfaceLeaseId: string;
    runtimeSurfaceId: string;
    mediaType: string;
    byteLength: number;
    result: CompleteFileExportResultV1["status"];
    durationMs: number;
  }>): void | Promise<void>;
  now?: () => number;
}>;

export class FileExportManager {
  private readonly intents: FileExportIntentStore;
  private readonly sessions = new Map<string, Session>();
  private readonly pendingSurfaces = new Set<string>();
  private readonly now: () => number;

  constructor(userData: string, private readonly ports: FileExportPorts) {
    this.intents = new FileExportIntentStore(userData);
    this.now = ports.now ?? Date.now;
  }

  async initialize() {
    await this.intents.initialize();
    for (const intent of this.intents.list()) {
      await rm(intent.partialPath, { force: true }).catch(() => undefined);
      await this.intents.remove(intent.exportId);
    }
  }

  async closeAndFlush() {
    await Promise.all(
      [...this.sessions.keys()].map((exportId) => this.cancel(exportId, "surface_closed"))
    );
    await this.intents.closeAndFlush();
  }

  artifactRoots() {
    const roots = [
      ...this.intents.list().map((intent) => ({
        appId: intent.appId,
        generationId: intent.generationId,
      })),
      ...[...this.sessions.values()].map((session) => ({
        appId: session.binding.appId,
        generationId: session.binding.generationId,
      })),
    ];
    return [...new Map(roots.map((root) => [`${root.appId}/${root.generationId}`, root])).values()];
  }

  async begin(input: {
    request: BeginFileExportRequestV1;
    binding: FileExportBinding;
    permit: GuiSideEffectPermit;
    granted: boolean;
    trustedGestureAt: number;
  }): Promise<BeginFileExportResultV1> {
    const request = beginFileExportRequestV1Schema.parse(input.request);
    if (!input.granted) return { status: "declined", reason: "permission" };
    if (this.now() - input.trustedGestureAt > 1_000 || input.trustedGestureAt > this.now()) {
      return { status: "declined", reason: "gesture" };
    }
    if (
      this.sessions.size + this.pendingSurfaces.size >= MAX_GLOBAL ||
      this.hasSurface(input.binding.runtimeSurfaceId) ||
      this.pendingSurfaces.has(input.binding.runtimeSurfaceId)
    ) {
      return { status: "declined", reason: "busy" };
    }
    const suggestedName = validateSuggestedName(request.suggestedName, request.mediaType);
    this.pendingSurfaces.add(input.binding.runtimeSurfaceId);
    let file: FileHandle | null = null;
    let partialPath = "";
    let exportId = "";
    try {
      const destinationPath = await this.ports.chooseDestination({
        suggestedName,
        mediaType: request.mediaType,
      });
      if (!destinationPath) return { status: "cancelled" };
      exportId = randomUUID();
      partialPath = join(
        dirname(destinationPath),
        `.${basename(destinationPath)}.bottega-${exportId}.partial`
      );
      this.ports.startPermit(input.permit);
      await this.intents.add({
        exportId,
        appId: input.binding.appId,
        generationId: input.binding.generationId,
        surfaceId: input.binding.runtimeSurfaceId,
        destinationPath,
        partialPath,
        createdAt: this.now(),
      });
      file = await open(partialPath, "wx", 0o600);
      const startedAt = this.now();
      const session: Session = {
        exportId,
        binding: input.binding,
        request,
        permit: input.permit,
        destinationPath,
        partialPath,
        file,
        hash: createHash("sha256"),
        bytes: 0,
        seq: 0,
        firstBytes: Buffer.alloc(0),
        validation: validationFor(request.mediaType),
        startedAt,
        touchedAt: startedAt,
        timer: setTimeout(() => this.cancel(exportId, "timeout").catch(() => undefined), IDLE_TIMEOUT_MS),
        serial: Promise.resolve(),
        chunkPending: false,
        terminal: false,
      };
      this.sessions.set(exportId, session);
      return { status: "accepted", exportId, maxChunkBytes: 65_536 };
    } catch (cause) {
      await file?.close().catch(() => undefined);
      if (partialPath) await rm(partialPath, { force: true }).catch(() => undefined);
      if (exportId) await this.intents.remove(exportId).catch(() => undefined);
      if (isFileExportBusy(cause)) return { status: "declined", reason: "busy" };
      throw cause;
    } finally {
      this.pendingSurfaces.delete(input.binding.runtimeSurfaceId);
    }
  }

  async write(header: WriteFileExportChunkHeaderV1, bytes: Uint8Array, runtimeSurfaceId?: string) {
    const parsed = writeFileExportChunkHeaderV1Schema.parse(header);
    if (parsed.byteLength !== bytes.byteLength) throw exportError("FILE_EXPORT_CHUNK_LENGTH");
    const session = this.require(parsed.exportId);
    if (session.chunkPending) throw exportError("FILE_EXPORT_BACKPRESSURE");
    session.chunkPending = true;
    try {
      const chunk = Buffer.from(bytes);
      return await this.enqueue(session, async () => {
        this.assertSession(session);
        this.assertSurface(session, runtimeSurfaceId);
        this.assertLive(session);
        if (parsed.seq !== session.seq) throw exportError("FILE_EXPORT_SEQUENCE");
        if (session.bytes + chunk.byteLength > session.request.byteLength) throw exportError("FILE_EXPORT_LENGTH");
        const offset = session.bytes;
        session.bytes += chunk.byteLength;
        session.seq += 1;
        try {
          await writeChunk(session.file, chunk, offset);
          absorb(session, chunk);
        } catch (cause) {
          await this.finish(session, { status: "failed", code: exportFailureCode(cause) }, true);
          throw cause;
        }
        session.hash.update(chunk);
        session.touchedAt = this.now();
        this.arm(session);
        return { exportId: session.exportId, seq: parsed.seq, acceptedBytes: chunk.byteLength };
      });
    } finally {
      session.chunkPending = false;
    }
  }

  async finalize(exportId: string, runtimeSurfaceId?: string): Promise<CompleteFileExportResultV1> {
    const session = this.require(exportId);
    return this.enqueue(session, async () => {
      this.assertSession(session);
      this.assertSurface(session, runtimeSurfaceId);
      this.assertLive(session);
      let result: CompleteFileExportResultV1;
      try {
        const digest = `sha256:${session.hash.digest("hex")}` as const;
        if (session.bytes !== session.request.byteLength || digest !== session.request.sha256) {
          throw exportError("FILE_EXPORT_INTEGRITY");
        }
        validateContent(session);
        await session.file.sync();
        await session.file.close();
        await rename(session.partialPath, session.destinationPath);
        await syncParent(session.destinationPath);
        result = { status: "saved", filename: basename(session.destinationPath), byteLength: session.bytes, sha256: digest };
        await this.finish(session, result, false);
        return result;
      } catch (cause) {
        result = { status: "failed", code: exportFailureCode(cause) };
        await this.finish(session, result, true);
        return result;
      }
    });
  }

  async cancel(
    exportId: string,
    reason: "cancelled" | "timeout" | "surface_closed" = "cancelled",
    runtimeSurfaceId?: string
  ) {
    const session = this.sessions.get(exportId);
    if (!session) return { status: "cancelled" as const };
    return this.enqueue(session, async () => {
      if (session.terminal) return { status: "cancelled" as const };
      this.assertSurface(session, runtimeSurfaceId);
      const result: CompleteFileExportResultV1 = reason === "cancelled"
        ? { status: "cancelled" }
        : { status: "failed", code: reason };
      await this.finish(session, result, true);
      return result;
    });
  }

  async closeSurface(runtimeSurfaceId: string) {
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => session.binding.runtimeSurfaceId === runtimeSurfaceId)
        .map((session) => this.cancel(session.exportId, "surface_closed"))
    );
  }

  async closeApp(appId: string) {
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => session.binding.appId === appId)
        .map((session) => this.cancel(session.exportId, "surface_closed"))
    );
  }

  private require(exportId: string) {
    const session = this.sessions.get(exportId);
    if (!session) throw exportError("FILE_EXPORT_SESSION_INVALID");
    return session;
  }

  private assertSession(session: Session) {
    if (session.terminal || this.sessions.get(session.exportId) !== session) {
      throw exportError("FILE_EXPORT_SESSION_INVALID");
    }
  }

  private async enqueue<T>(session: Session, operation: () => Promise<T>) {
    const previous = session.serial;
    let release!: () => void;
    session.serial = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private assertLive(session: Session) {
    const now = this.now();
    if (now - session.startedAt > MAX_LIFETIME_MS || now - session.touchedAt > IDLE_TIMEOUT_MS) {
      throw exportError("FILE_EXPORT_TIMEOUT");
    }
  }

  private assertSurface(session: Session, runtimeSurfaceId?: string) {
    if (runtimeSurfaceId && session.binding.runtimeSurfaceId !== runtimeSurfaceId) {
      throw exportError("FILE_EXPORT_SURFACE_INVALID");
    }
  }

  private hasSurface(runtimeSurfaceId: string) {
    return [...this.sessions.values()].some((session) => session.binding.runtimeSurfaceId === runtimeSurfaceId);
  }

  private arm(session: Session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => this.cancel(session.exportId, "timeout").catch(() => undefined), IDLE_TIMEOUT_MS);
  }

  private async finish(session: Session, result: CompleteFileExportResultV1, removePartial: boolean) {
    if (session.terminal) return;
    session.terminal = true;
    clearTimeout(session.timer);
    this.sessions.delete(session.exportId);
    await session.file.close().catch(() => undefined);
    if (removePartial) await rm(session.partialPath, { force: true }).catch(() => undefined);
    await this.intents.remove(session.exportId);
    this.ports.completePermit(session.permit, result);
    await this.ports.audit({
      appId: session.binding.appId,
      generationId: session.binding.generationId,
      surfaceLeaseId: session.binding.surfaceLeaseId,
      runtimeSurfaceId: session.binding.runtimeSurfaceId,
      mediaType: session.request.mediaType,
      byteLength: session.bytes,
      result: result.status,
      durationMs: this.now() - session.startedAt,
    });
  }
}

function validateSuggestedName(name: string, mediaType: BeginFileExportRequestV1["mediaType"]) {
  const suffix = FILE_EXPORT_SUFFIX[mediaType];
  if (
    Buffer.byteLength(name, "utf8") > 255 || name !== basename(name) || name.includes("/") ||
    name.includes("\\") || name.includes(":") || name === "." || name === ".." ||
    WINDOWS_RESERVED.test(name) || /[. ]$/.test(name)
  ) throw exportError("FILE_EXPORT_NAME_INVALID");
  const extension = extname(name).toLowerCase();
  if (extension && extension !== suffix) throw exportError("FILE_EXPORT_SUFFIX_INVALID");
  return extension ? name : `${name}${suffix}`;
}

function validationFor(mediaType: BeginFileExportRequestV1["mediaType"]): Validation {
  if (mediaType === "application/json") return { kind: "json", chunks: [] };
  return mediaType.startsWith("text/")
    ? { kind: "utf8", decoder: new TextDecoder("utf-8", { fatal: true }) }
    : { kind: "signature" };
}

/* 每块只留它可能贡献的那点东西：签名要的前 16 字节最多再拷 16 字节，
   UTF-8 逐块判定，JSON 才留全文。 */
function absorb(session: Session, chunk: Buffer) {
  if (session.firstBytes.length < 16) {
    session.firstBytes = Buffer.concat([session.firstBytes, chunk.subarray(0, 16)]).subarray(0, 16);
  }
  const validation = session.validation;
  if (validation.kind === "json") validation.chunks.push(chunk);
  if (validation.kind !== "utf8") return;
  try {
    validation.decoder.decode(chunk, { stream: true });
  } catch {
    throw exportError("FILE_EXPORT_TYPE");
  }
}

function validateContent(session: Session) {
  const validation = session.validation;
  if (validation.kind === "utf8") {
    /* 收尾解码不能省：断在半个码点上的文件在流式阶段是「还没读完」，只有
       这一下 flush 能把它判成非法。 */
    try {
      validation.decoder.decode();
    } catch {
      throw exportError("FILE_EXPORT_TYPE");
    }
    return;
  }
  if (validation.kind === "json") {
    try {
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(validation.chunks)));
    } catch {
      throw exportError("FILE_EXPORT_TYPE");
    }
    return;
  }
  const mediaType = session.request.mediaType;
  const signatures: Record<string, readonly number[]> = {
    "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/gif": [0x47, 0x49, 0x46, 0x38],
    "image/webp": [0x52, 0x49, 0x46, 0x46],
  };
  const signature = signatures[mediaType];
  if (!signature?.every((byte, index) => session.firstBytes[index] === byte)) throw exportError("FILE_EXPORT_TYPE");
  if (mediaType === "image/webp" && session.firstBytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw exportError("FILE_EXPORT_TYPE");
  }
}

async function writeChunk(file: FileHandle, chunk: Buffer, offset: number) {
  let written = 0;
  while (written < chunk.byteLength) {
    const result = await file.write(
      chunk,
      written,
      chunk.byteLength - written,
      offset + written
    );
    if (result.bytesWritten <= 0) throw exportError("FILE_EXPORT_IO_SHORT_WRITE");
    written += result.bytesWritten;
  }
}

/* win32 打不开目录句柄（open(dir,"r") 直接 EISDIR/EPERM），而 NTFS 的
   rename 本身就是元数据事务，不需要额外 fsync 父目录。POSIX 上必须保留：
   rename 落盘了，目录项没落盘，崩溃后文件就会消失。 */
async function syncParent(path: string) {
  if (process.platform === "win32") return;
  const parent = await open(dirname(path), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

function exportFailureCode(cause: unknown): "integrity" | "timeout" | "io" | "surface_closed" {
  const code = (cause as { code?: string }).code ?? "";
  if (code.includes("TIMEOUT")) return "timeout";
  if (code.includes("INTEGRITY") || code.includes("LENGTH") || code.includes("TYPE")) return "integrity";
  return "io";
}

function exportError(code: string) {
  return Object.assign(new Error(code), { code, status: 400 });
}
