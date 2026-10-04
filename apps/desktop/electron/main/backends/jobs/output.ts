/**
 * [INPUT]: Depends on the ACP 64 KiB stderr byte ring and the headless parser state type
 * [OUTPUT]: Provides HeadlessOutputReader (stdout line splitting through a Provider's `parseLine`, the 1 MB line and 32 MB output limits, the final unterminated line, the raw 64 KiB stderr tail) the limit constants, and EventQueue (a run's live items, in order)
 * [POS]: The one reading of a headless job's output, shared by the in-process executor (jobs/executor.ts) and the Provider bridge's `headless.run`, so both paths yield the same `{text, json}` from the same bytes (TASK-11 D8, P16); pure and bridge-safe (no Electron, no runtime port, no secrets: stderr redaction stays with main, which holds the environment)
 */
import { AcpByteTail } from "../acp/startup/evidence";
import type { HeadlessParserState } from "../types";

type AgentTurnItem = HeadlessParserState["events"][number];

export const MAX_LINE_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_STDERR_BYTES = 64 * 1024;

export class HeadlessOutputReader {
  readonly state: HeadlessParserState = { text: "", events: [] };
  /** Set once a limit trips; the caller stops the job and reports it. */
  limitError: Error | undefined;
  private buffer = "";
  private outputBytes = 0;
  private readonly stderrRing = new AcpByteTail(MAX_STDERR_BYTES);

  constructor(
    private readonly parseLine: (line: string, state: HeadlessParserState) => void,
    private readonly onEvent: (event: AgentTurnItem) => void = () => {}
  ) {}

  /** Returns false once a limit tripped: nothing more is read. */
  stdout(chunk: Buffer | string): boolean {
    if (this.limitError) return false;
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength;
    this.outputBytes += bytes;
    if (this.outputBytes > MAX_OUTPUT_BYTES) { this.limitError = new Error("headless 输出超过 32MB"); return false; }
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) if (!this.line(line)) return false;
    return true;
  }

  stderr(chunk: Buffer | string) { this.stderrRing.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk); }

  /** The process closed: its last, unterminated line still counts (unless reading already stopped). */
  flush() {
    if (!this.limitError && this.buffer) this.line(this.buffer);
    this.buffer = "";
  }

  /** The raw tail; whoever holds the environment redacts it before it becomes evidence. */
  stderrTail() { return this.stderrRing.text().trim(); }

  private line(line: string) {
    if (!line.trim()) return true;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) { this.limitError = new Error("headless 单行输出超过 1MB"); return false; }
    const before = this.state.events.length;
    this.parseLine(line, this.state);
    for (const event of this.state.events.slice(before)) this.onEvent(event);
    return true;
  }
}

/** The job's live items, in order, for whoever iterates a run's `events`. */
export class EventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T) {
    if (this.ended) return;
    const reader = this.readers.shift();
    if (reader) reader({ done: false, value });
    else this.values.push(value);
  }

  end() {
    this.ended = true;
    for (const reader of this.readers.splice(0)) {
      reader({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.ended) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => this.readers.push(resolve));
      },
    };
  }
}
