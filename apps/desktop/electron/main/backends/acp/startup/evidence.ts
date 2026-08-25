/**
 * [INPUT]: Depends on Node Buffer/StringDecoder/os, ACP stderr with name noise reduction, shared diagnostic hypersensitivity, and with call party literal secrets, and exit, to position the native language
 * [OUTPUT]: Provides a fixed 64KiB byte ring AcpByteTail with AcpProcessEvidence ((reduced noise after complete reassembly, raw classification, lazy exit, perpetual de-sensitivity)
 * [POS]: The owner of the process proof of ACP startup; AcpTurn/probe/headless only bytes and withdrawal signals, no longer maintaining their respective string intercepts
 */

import { StringDecoder } from "node:string_decoder";
import { createStderrNoiseFilter } from "../stderr-noise";
import {
  acpDiagnosticRedactionOptions,
  redactAcpDiagnostic,
  type AcpDiagnosticRedactionOptions,
} from "../trace";
import {
  preferProcessExit,
  type AcpExitReport,
} from "./exit";

export const ACP_STDERR_TAIL_BYTES = 64 * 1024;
const ACP_STDERR_LOG_BYTES = 64 * 1024;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

/** 固定容量字节环；任何总输入量下都只持有最后 limit 字节。 */
export class AcpByteTail {
  private readonly storage: Buffer;
  private cursor = 0;
  private size = 0;

  constructor(readonly limit = ACP_STDERR_TAIL_BYTES) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("ACP byte tail limit 必须是正整数");
    }
    this.storage = Buffer.allocUnsafe(limit);
  }

  write(value: Buffer | Uint8Array | string) {
    const source =
      typeof value === "string"
        ? Buffer.from(value)
        : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    const chunk =
      source.byteLength >= this.limit
        ? source.subarray(source.byteLength - this.limit)
        : source;
    const first = Math.min(chunk.byteLength, this.limit - this.cursor);
    chunk.copy(this.storage, this.cursor, 0, first);
    if (first < chunk.byteLength) {
      chunk.copy(this.storage, 0, first);
    }
    this.cursor = (this.cursor + chunk.byteLength) % this.limit;
    this.size = Math.min(this.limit, this.size + chunk.byteLength);
  }

  bytes() {
    if (this.size < this.limit) {
      return Buffer.from(this.storage.subarray(0, this.size));
    }
    if (this.cursor === 0) return Buffer.from(this.storage);
    return Buffer.concat([
      this.storage.subarray(this.cursor),
      this.storage.subarray(0, this.cursor),
    ]);
  }

  text() {
    const value = this.bytes();
    let start = 0;
    while (start < value.byteLength && (value[start]! & 0xc0) === 0x80) {
      start += 1;
    }
    return value.subarray(start).toString("utf8");
  }
}

export class AcpProcessEvidence {
  private readonly decoder = new StringDecoder("utf8");
  private readonly noise = createStderrNoiseFilter();
  private readonly tail = new AcpByteTail();
  private readonly exit = deferred<AcpExitReport>();
  private readonly redaction: AcpDiagnosticRedactionOptions;
  private loggedBytes = 0;
  /* 降噪器的判据是「整行」；pipe 会把一行切成任意 chunk，半行喂进去
     会让具名噪声头（如 chokidar EPERM 块首）匹配失败、整块噪声漏进
     证据环。这里先重组行，再交降噪。 */
  private lineBuffer = "";

  constructor(
    env: NodeJS.ProcessEnv,
    extra: AcpDiagnosticRedactionOptions = {}
  ) {
    const base = acpDiagnosticRedactionOptions(env);
    this.redaction = {
      ...base,
      ...extra,
      homes: [...(base.homes ?? []), ...(extra.homes ?? [])],
      secrets: [...(base.secrets ?? []), ...(extra.secrets ?? [])],
      credentialPaths: [
        ...(base.credentialPaths ?? []),
        ...(extra.credentialPaths ?? []),
      ],
    };
  }

  writeStderr(chunk: Buffer | Uint8Array | string) {
    return this.capture(this.decoder.write(Buffer.from(chunk)));
  }

  endStderr() {
    const flushed = this.capture(this.decoder.end());
    if (!this.lineBuffer) return flushed;
    /* 流已终结，残留的最后一段就是完整的最后一行。 */
    const last = this.emitLines(this.lineBuffer);
    this.lineBuffer = "";
    return [flushed, last].filter(Boolean).join("\n");
  }

  rawTail() {
    return this.tail.text().trim();
  }

  redact(text: string) {
    return redactAcpDiagnostic(text, this.redaction);
  }

  recordExit(code: number | null, signal: NodeJS.Signals | null) {
    const report: AcpExitReport = {
      code,
      signal,
      /* exit 与 stderr 是独立事件源；消费时才读，避免 exit 抢先快照。 */
      stderrTail: () => this.rawTail(),
    };
    this.exit.resolve(report);
    return report;
  }

  waitForExit() {
    return this.exit.promise;
  }

  preferExit(cause: unknown) {
    return preferProcessExit(cause, this.exit.promise, {
      stderrTail: () => this.rawTail(),
    });
  }

  private capture(text: string) {
    if (!text) return "";
    this.lineBuffer += text;
    const segments = this.lineBuffer.split("\n");
    this.lineBuffer = segments.pop() ?? "";
    if (!segments.length) return "";
    return this.emitLines(segments.join("\n"));
  }

  private emitLines(lines: string) {
    const filtered = this.noise(lines);
    if (!filtered) return "";
    this.tail.write(`${filtered}\n`);
    const remaining = ACP_STDERR_LOG_BYTES - this.loggedBytes;
    if (remaining <= 0) return "";
    const visible = Buffer.from(filtered).subarray(0, remaining);
    this.loggedBytes += visible.byteLength;
    return this.redact(visible.toString("utf8"));
  }
}
