/**
 * [INPUT]: The already-bound isolated Service Worker and application WebSocket calls.
 * [OUTPUT]: installTunnelWebSocket, a keyless standard-event facade over worker-owned encrypted transport.
 * [POS]: Dormant App compatibility layer; never exposes the tunnel URL, key or browser cookies.
 */
export function installTunnelWebSocket() {
  class TunnelSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
    readyState = 0; bufferedAmount = 0; binaryType: BinaryType = "arraybuffer"; extensions = ""; protocol = "";
    readonly url: string; private port: MessagePort;
    onopen: ((event: Event) => unknown) | null = null; onmessage: ((event: MessageEvent) => unknown) | null = null;
    onclose: ((event: CloseEvent) => unknown) | null = null; onerror: ((event: Event) => unknown) | null = null;
    constructor(value: string | URL, protocols?: string | string[]) {
      super(); const url = new URL(value, location.href); this.url = url.href;
      const requested = protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : protocols;
      if (url.host !== location.host || !["ws:", "wss:"].includes(url.protocol) || requested.length > 8 ||
        new Set(requested).size !== requested.length || requested.some(value => !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/i.test(value))) throw new Error("tunnel-websocket-protocol-unsupported");
      const worker = navigator.serviceWorker.controller; if (!worker) throw new Error("tunnel-worker-unavailable");
      const channel = new MessageChannel(); this.port = channel.port1;
      this.port.onmessage = event => {
        const kind = event.data?.type;
        if (kind === "open") { this.readyState = 1; this.protocol = event.data.protocol ?? ""; const e = new Event("open"); this.dispatchEvent(e); this.onopen?.(e); }
        else if (kind === "close") { this.readyState = 3; const e = new CloseEvent("close"); this.dispatchEvent(e); this.onclose?.(e); this.port.close(); }
        else if (kind === "message") { const bytes = new Uint8Array(event.data.bytes);
          const data = event.data.binary ? this.binaryType === "blob" ? new Blob([bytes]) : bytes.buffer : new TextDecoder().decode(bytes);
          const e = new MessageEvent("message", { data }); this.dispatchEvent(e); this.onmessage?.(e); }
      };
      worker.postMessage({ type: "bottega:tunnel:ws", path: url.pathname.replace(/^\/app\//, "/") + url.search, protocols: requested }, [channel.port2]);
    }
    send(value: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== 1) throw new DOMException("WebSocket is not open", "InvalidStateError");
      if (value instanceof Blob) { void value.arrayBuffer().then(buffer => this.send(buffer)); return; }
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() : new Uint8Array(value).slice();
      this.port.postMessage({ type: "send", bytes, binary: typeof value !== "string" }, [bytes.buffer]);
    }
    close() { if (this.readyState >= 2) return; this.readyState = 2; this.port.postMessage({ type: "close" }); }
  }
  Object.defineProperty(globalThis, "WebSocket", { value: TunnelSocket, configurable: false, writable: false });
}
