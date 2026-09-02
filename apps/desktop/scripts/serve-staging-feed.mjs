/**
 * [INPUT]: Depends on BOTTEGA_STAGING_FEED_DIR, optional BOTTEGA_STAGING_FEED_PORT, and an injectable regular-file stream factory
 * [OUTPUT]: Provides range/multipart planning plus an abort-safe loopback server that rejects path and symlink escape
 * [POS]: Local generic-provider feed for signed staging update tests; it is not a publication server
 */

import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

export function parseFeedPort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("BOTTEGA_STAGING_FEED_PORT is invalid");
  }
  return port;
}

/* ============================================================
 * Range 必须真做，不能只挂个 Accept-Ranges。
 *
 * electron-updater 的 `checkIsRangesSupported` 判据是：状态码不是 206 时，
 * 只要响应带了 `Accept-Ranges` 且不为 "none"，它就认定服务端支持 range，
 * 继续把整段 200 全量 body 当 multipart/byteranges 去切——直接切成垃圾。
 * 所以"声明支持但返回全量"比完全不声明更坏。
 *
 * 而完全不声明的代价是：差分下载每次都退化成全量，layer-2 演练永远走不到
 * 真实用户升级会走的那条路——这正是本仓最忌讳的假绿。
 *
 * 因此单段走 206，多段走标准 multipart/byteranges：首段以 `--boundary`
 * 开头（无前导 CRLF），段间以 `\r\n--boundary` 分隔，头部以 `\r\n\r\n`
 * 收尾——与 DataSplitter 的偏移算术逐字节对齐。
 * ============================================================ */
export function createStagingFeedServer(
  root,
  {
    boundaryFactory = () => randomBytes(16).toString("hex"),
    streamFactory = createReadStream,
  } = {}
) {
  const feedRoot = resolve(root);
  return createServer((request, response) => {
    const name = basename(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    if (!name || name === ".") return void respond(response, 404);
    let file;
    try {
      file = resolveFeedFile(feedRoot, name);
    } catch {
      return void respond(response, 404);
    }
    if (!file) return void respond(response, 404);
    const { path, size } = file;
    const type = name.endsWith(".yml") ? "text/yaml" : "application/octet-stream";
    const ranges = parseRanges(request.headers.range, size);
    if (ranges === "unsatisfiable") {
      response.writeHead(416, {
        "accept-ranges": "bytes",
        "content-range": `bytes */${size}`,
      });
      return void response.end();
    }
    if (!ranges) {
      response.writeHead(200, {
        "accept-ranges": "bytes",
        "content-type": type,
        "content-length": size,
      });
      return void pipeFile(request, response, path, undefined, streamFactory);
    }
    if (ranges.length === 1) {
      const [{ start, end }] = ranges;
      response.writeHead(206, {
        "accept-ranges": "bytes",
        "content-type": type,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": end - start + 1,
      });
      return void pipeFile(request, response, path, { start, end }, streamFactory);
    }
    writeMultipart(request, response, path, type, size, ranges, boundaryFactory, streamFactory);
  });
}

export function resolveFeedFile(root, name) {
  const feedRoot = realpathSync(resolve(root));
  const path = realpathSync(join(feedRoot, name));
  const inside = relative(feedRoot, path);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return null;
  }
  const stats = statSync(path);
  return stats.isFile() ? { path, size: stats.size } : null;
}

function pipeFile(request, response, path, options, streamFactory) {
  const source = streamFactory(path, options);
  const abort = () => source.destroy();
  const cleanup = () => {
    request.removeListener("aborted", abort);
    response.removeListener("close", onClose);
  };
  const onClose = () => {
    if (!response.writableEnded) abort();
  };
  request.once("aborted", abort);
  response.once("close", onClose);
  source.once("close", cleanup);
  source.once("error", () => {
    cleanup();
    if (!response.destroyed) response.destroy();
  });
  source.pipe(response);
}

function writeMultipart(
  request,
  response,
  path,
  type,
  size,
  ranges,
  boundaryFactory,
  streamFactory
) {
  const { boundary, heads, tail, length } = createMultipartPlan(
    type,
    size,
    ranges,
    boundaryFactory()
  );
  response.writeHead(206, {
    "accept-ranges": "bytes",
    "content-type": `multipart/byteranges; boundary=${boundary}`,
    "content-length": length,
  });
  let active;
  let aborted = false;
  const abort = () => {
    aborted = true;
    active?.destroy();
  };
  const cleanup = () => {
    request.removeListener("aborted", abort);
    response.removeListener("close", onClose);
  };
  const onClose = () => {
    if (!response.writableEnded) abort();
    cleanup();
  };
  request.once("aborted", abort);
  response.once("close", onClose);
  const writePart = (index) => {
    if (aborted) return;
    if (index >= ranges.length) {
      cleanup();
      return void response.end(tail);
    }
    response.write(heads[index]);
    active = streamFactory(path, ranges[index]);
    active.on("error", () => {
      cleanup();
      if (!response.destroyed) response.destroy();
    });
    active.on("end", () => {
      active = undefined;
      writePart(index + 1);
    });
    active.pipe(response, { end: false });
  };
  writePart(0);
}

export function createMultipartPlan(type, size, ranges, boundary) {
  if (!/^[A-Za-z0-9]+$/.test(boundary)) throw new Error("invalid multipart boundary");
  const heads = ranges.map(
    ({ start, end }, index) =>
      `${index === 0 ? "" : "\r\n"}--${boundary}\r\n` +
      `content-type: ${type}\r\n` +
      `content-range: bytes ${start}-${end}/${size}\r\n\r\n`
  );
  const tail = `\r\n--${boundary}--\r\n`;
  const length =
    heads.reduce((sum, head, index) => sum + Buffer.byteLength(head) + span(ranges[index]), 0) +
    Buffer.byteLength(tail);
  return { boundary, heads, tail, length };
}

const span = ({ start, end }) => end - start + 1;

/**
 * 返回 null 表示"按无 Range 处理"（RFC 允许服务端忽略无法解析的 Range），
 * "unsatisfiable" 表示必须回 416，否则返回归一化后的闭区间数组。
 */
export function parseRanges(header, size) {
  if (typeof header !== "string") return null;
  const match = /^bytes=(.+)$/i.exec(header.trim());
  if (!match) return null;
  const ranges = [];
  for (const entry of match[1].split(",")) {
    const spec = entry.trim();
    const suffix = /^-(\d+)$/.exec(spec);
    if (suffix) {
      const length = Number(suffix[1]);
      if (length === 0 || size === 0) return "unsatisfiable";
      ranges.push({ start: Math.max(0, size - length), end: size - 1 });
      continue;
    }
    const explicit = /^(\d+)-(\d*)$/.exec(spec);
    if (!explicit) return null;
    const start = Number(explicit[1]);
    const end = explicit[2] === "" ? size - 1 : Number(explicit[2]);
    if (start >= size || start > end) return "unsatisfiable";
    ranges.push({ start, end: Math.min(end, size - 1) });
  }
  return ranges.length > 0 ? ranges : null;
}

function respond(response, status) {
  response.writeHead(status);
  response.end();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(process.env.BOTTEGA_STAGING_FEED_DIR ?? "release");
  const port = parseFeedPort(process.env.BOTTEGA_STAGING_FEED_PORT ?? 19480);
  const server = createStagingFeedServer(root);
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`staging feed: http://127.0.0.1:${port}/\n`);
  });
}
