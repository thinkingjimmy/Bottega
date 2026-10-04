/**
 * [INPUT]: Depends on node:net and node:http.
 * [OUTPUT]: Provides openRequestSink: a loopback listener on an ephemeral port that Bottega holds for the whole probe; every connection is destroyed on accept while still paused, so not one byte of the request (its Authorization header included) is ever read or logged. openScriptedEndpoint: a loopback Anthropic Messages endpoint that answers from a script, not a model (one Bash call, then the end of the turn), dropping credential headers unread and keeping only counts.
 * [POS]: providers/measurements' answer to P4/P5/N6: a probed CLI sends its credentials to its base URL, so the base URL must be an address only Bottega can own; a fixed port could be taken first by any local process.
 */
import { createServer as createHttpServer, type ServerResponse } from "node:http";
import { createServer, type AddressInfo } from "node:net";

export async function openRequestSink() {
  let accepted = 0, bytesRead = 0;
  /* pauseOnConnect: the socket never starts reading, and destroy() drops whatever the kernel buffered. */
  const server = createServer({ pauseOnConnect: true }, socket => {
    accepted += 1;
    bytesRead += socket.bytesRead;
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    /** For the regression: connections were refused without reading anything. */
    stats: () => ({ accepted, bytesRead }),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const CREDENTIAL_HEADERS = ["authorization", "x-api-key", "anthropic-api-key", "cookie"];
type MessagesBody = { stream?: boolean; tools?: { name?: unknown }[]; messages?: { content?: unknown }[] };

/* The Messages API's streaming shape, as much of it as the CLI reads: one content block per response. */
function answer(response: ServerResponse, id: string, block: Record<string, unknown>, stream: boolean) {
  const stop = block.type === "tool_use" ? "tool_use" : "end_turn";
  if (!stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id, type: "message", role: "assistant", model: "scripted", content: [block], stop_reason: stop, stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (event: string, data: Record<string, unknown>) => response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  send("message_start", { message: { id, type: "message", role: "assistant", model: "scripted", content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } } });
  send("content_block_start", { index: 0, content_block: block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" } });
  send("content_block_delta", { index: 0, delta: block.type === "tool_use" ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
    : { type: "text_delta", text: block.text } });
  send("content_block_stop", { index: 0 });
  send("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  send("message_stop", {});
  response.end();
}

/**
 * A model stand-in for a probe that needs the CLI to run one command: while the turn offers Bash and no tool result is back, it
 * asks for `command`; otherwise it ends the turn. No model runs and no quota is spent. Credential headers are deleted before
 * anything reads the request and the body is dropped once parsed; only counts survive (N6).
 */
export async function openScriptedEndpoint(command: string) {
  let requests = 0, bashCalls = 0;
  const server = createHttpServer((request, response) => {
    for (const header of CREDENTIAL_HEADERS) delete request.headers[header];
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let body: MessagesBody = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not JSON: answered as a finished turn */ }
      chunks.length = 0;
      const path = (request.url ?? "").split("?")[0]!;
      if (path.endsWith("/count_tokens")) { response.writeHead(200, { "content-type": "application/json" }); response.end('{"input_tokens":1}'); return; }
      if (!path.endsWith("/v1/messages")) { response.writeHead(404); response.end(); return; }
      requests += 1;
      const answered = (body.messages ?? []).some(message => Array.isArray(message.content) &&
        message.content.some(part => (part as { type?: unknown } | null)?.type === "tool_result"));
      const ask = !answered && (body.tools ?? []).some(tool => tool?.name === "Bash");
      if (ask) bashCalls += 1;
      answer(response, `msg_probe_${requests}`, ask ? { type: "tool_use", id: `toolu_probe_${bashCalls}`, name: "Bash", input: { command, description: "probe" } }
        : { type: "text", text: "done" }, body.stream === true);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stats: () => ({ requests, bashCalls }),
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
