/**
 * [INPUT]: Depends on Node fs read streams and the web TextDecoder
 * [OUTPUT]: Provides jsonlLines, the one JSONL line reader for a file path or a byte/text stream: records split on "\n" only, with an unfinished final line marked
 * [POS]: The persistence reader for newline-delimited JSON (Agent usage logs, Library transcripts, an ACP agent's stdout in the readiness probe); none of them may read JSONL through node:readline
 */

import { createReadStream } from "node:fs";

/**
 * Every line of a JSONL file (a path) or stream (a child's stdout), split on "\n" only (a CR before it is dropped). readline
 * cannot do this: from Node 24 it also ends a line at U+2028/U+2029, which JSON.stringify leaves raw inside strings, so one
 * record reads as two broken halves. `complete` is false only for a final line with no newline after it: a writer still
 * appending, not a damaged record. A byte stream is decoded as UTF-8 across chunk boundaries. `signal` aborts a file read; a
 * stream's owner ends a stream read by destroying the stream.
 */
export async function* jsonlLines(
  source: string | AsyncIterable<string | Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<{ line: string; complete: boolean }> {
  const input = typeof source === "string" ? createReadStream(source, { encoding: "utf8", signal }) as AsyncIterable<string> : source;
  const decoder = new TextDecoder();
  let rest = "";
  for await (const piece of input) {
    const chunk = typeof piece === "string" ? piece : decoder.decode(piece, { stream: true });
    let start = 0;
    for (let end = chunk.indexOf("\n"); end !== -1; end = chunk.indexOf("\n", start)) {
      const line = rest + chunk.slice(start, end);
      rest = "";
      start = end + 1;
      yield { line: line.endsWith("\r") ? line.slice(0, -1) : line, complete: true };
    }
    rest += chunk.slice(start);
  }
  rest += decoder.decode();
  if (rest) yield { line: rest, complete: false };
}
