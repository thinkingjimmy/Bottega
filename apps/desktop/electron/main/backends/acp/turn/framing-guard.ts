/**
 * [INPUT]: Depends on Node Transform and ACP stdout
 * [OUTPUT]: Provides single-bar, cumulative bytes, number of events and speed budget tab before SDK decoding
 * [POS]: ACP turn the outermost layer of the security border; Unfiltered bytes never enter JSON decoder
 */

import { Transform, type TransformCallback } from "node:stream";

export const ACP_MAX_FRAME_BYTES = 1024 * 1024;
export const ACP_MAX_DELTA_BYTES = 64 * 1024;
const ACP_MAX_TURN_BYTES = 32 * 1024 * 1024;
const ACP_MAX_TURN_EVENTS = 50_000;
export const ACP_MAX_EVENTS_PER_SECOND = 1_000;
export type AcpPolicyViolation = {
  budget: string;
  detail: string;
};

class AcpBudgetError extends Error {
  constructor(readonly violation: AcpPolicyViolation) {
    super(`ACP 资源预算违规（${violation.budget}）：${violation.detail}`);
    this.name = "AcpBudgetError";
  }
}

export class AcpFramingGuard extends Transform {
  private frameBytes = 0;
  private totalBytes = 0;
  private totalEvents = 0;
  private windowStartedAt = Date.now();
  private windowEvents = 0;
  private violated = false;

  constructor(
    private readonly onViolation: (violation: AcpPolicyViolation) => void
  ) {
    super();
  }

  private fail(budget: string, detail: string, callback: TransformCallback) {
    if (this.violated) return callback();
    this.violated = true;
    const violation = { budget, detail };
    this.onViolation(violation);
    callback(new AcpBudgetError(violation));
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    if (this.violated) return callback();
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > ACP_MAX_TURN_BYTES) {
      return this.fail(
        "turn-bytes",
        `${this.totalBytes} > ${ACP_MAX_TURN_BYTES}`,
        callback
      );
    }
    for (const byte of chunk) {
      if (byte === 0x0a) {
        this.totalEvents += 1;
        this.windowEvents += 1;
        this.frameBytes = 0;
        if (this.totalEvents > ACP_MAX_TURN_EVENTS) {
          return this.fail(
            "turn-events",
            `${this.totalEvents} > ${ACP_MAX_TURN_EVENTS}`,
            callback
          );
        }
        const now = Date.now();
        if (now - this.windowStartedAt >= 1_000) {
          this.windowStartedAt = now;
          this.windowEvents = 0;
        } else if (this.windowEvents > ACP_MAX_EVENTS_PER_SECOND) {
          return this.fail(
            "event-rate",
            `${this.windowEvents}/s > ${ACP_MAX_EVENTS_PER_SECOND}/s`,
            callback
          );
        }
        continue;
      }
      this.frameBytes += 1;
      if (this.frameBytes > ACP_MAX_FRAME_BYTES) {
        return this.fail(
          "frame-bytes",
          `${this.frameBytes} > ${ACP_MAX_FRAME_BYTES}`,
          callback
        );
      }
    }
    this.push(chunk);
    callback();
  }
}
