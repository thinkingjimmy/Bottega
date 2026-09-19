/**
 * [INPUT]: A host-owned dedicated Worker transport and closed crypto commands/results.
 * [OUTPUT]: Bounded pipelined worker ownership with deadlines, stale-generation and exclusive key admission guards.
 * [POS]: Client event-loop facade; all expensive crypto stays in the dedicated worker.
 */
import { assertCrypto, CRYPTO_ERROR_CODES, CryptoError, type CryptoScope } from "@ai-chat/cloud-protocol/encryption";
import type { CryptoCommand, CryptoResult, CryptoWorkerPort, CryptoWorkerResponse } from "./model";
import { validateCryptoCommand } from "./commands";
import { ownedBuffers } from "./buffers";

let activeKdfOwner: object | null = null;

export interface CryptoWorkerOwnerOptions {
  source: Pick<CryptoScope, "sourceEnvironment" | "sourceAccountId">;
  createWorker(): CryptoWorkerPort;
  timeoutMs?: number;
}

export interface CryptoWorkerOwner {
  run(command: CryptoCommand, signal?: AbortSignal, transferOwned?: boolean): Promise<CryptoResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export function createCryptoWorkerOwner(options: CryptoWorkerOwnerOptions): CryptoWorkerOwner {
  const lease = {}, source = { ...options.source };
  let generation = 0, nextId = 0, port: CryptoWorkerPort | undefined, removers: (() => void)[] = [];
  let closed = false, stopping: Promise<void> | undefined, quarantined = false;
  const pending = new Map<number, { generation: number; exclusive: boolean; resolve(value: CryptoResult): void; reject(error: CryptoError): void; removeAbort(): void }>();
  const releaseLease = () => { if (activeKdfOwner === lease) activeKdfOwner = null; };
  const takePending = (id: number) => { const result = pending.get(id); pending.delete(id); result?.removeAbort(); return result; };
  const rejectPending = (code: "sync-operation-cancelled" | "sync-encryption-unsupported") => {
    for (const id of pending.keys()) takePending(id)?.reject(new CryptoError(code));
  };

  const stop = (): Promise<void> => {
    generation++;
    rejectPending("sync-operation-cancelled");
    if (stopping) return stopping;
    const current = port;
    port = undefined;
    for (const remove of removers) remove();
    removers = [];
    if (!current) { if (!quarantined) releaseLease(); return Promise.resolve(); }
    // Invalidate immediately, but retain the KDF lease until termination settles.
    stopping = Promise.resolve().then(() => current.terminate()).then(() => { releaseLease(); }, () => {
      quarantined = true;
      throw new CryptoError("sync-encryption-unsupported");
    }).finally(() => { stopping = undefined; });
    return stopping;
  };

  const failWorker = () => {
    rejectPending("sync-encryption-unsupported");
    void stop().catch(() => { /* A failed termination keeps this owner quarantined. */ });
  };

  const onMessage = (response: CryptoWorkerResponse) => {
    const request = pending.get(response?.id);
    if (!request || response.generation !== request.generation || response.generation !== generation) return;
    const current = takePending(response.id);
    if (current?.exclusive) releaseLease();
    if (response.ok === true) current?.resolve(response.result);
    else current?.reject(new CryptoError(CRYPTO_ERROR_CODES.includes(response.error) ? response.error : "sync-encryption-unsupported"));
  };

  const owner: CryptoWorkerOwner = {
    run(command, signal, transferOwned = false) {
      try {
        assertCrypto(!closed && !quarantined, "sync-encryption-unsupported");
        const exclusive = ["create", "unlock", "import-local-key", "lock"].includes(command.kind);
        assertCrypto(!stopping && pending.size < 4 && (!exclusive || pending.size === 0) &&
          ![...pending.values()].some(request => request.exclusive), "sync-operation-busy");
        assertCrypto(!signal?.aborted, "sync-operation-cancelled");
        validateCryptoCommand(command);
        const commandScope = command.kind === "create" ? command.source : command.kind === "skill-slug-key" || command.kind === "unlock" || command.kind === "export-local-key" || command.kind === "import-local-key" ? command.expectedScope :
          command.kind === "encrypt" ? command.context : command.kind === "decrypt" ? command.expectedContext : null;
        if (commandScope) assertCrypto(commandScope.sourceEnvironment === source.sourceEnvironment && commandScope.sourceAccountId === source.sourceAccountId, "sync-space-changed");
        if (command.kind === "create" || command.kind === "unlock") {
          assertCrypto(activeKdfOwner === null, "sync-operation-busy");
          activeKdfOwner = lease;
        }
        if (!port) {
          try {
            port = options.createWorker();
            removers = [port.onMessage(onMessage), port.onError(failWorker)];
          } catch { failWorker(); throw new CryptoError("sync-encryption-unsupported"); }
        }
        const id = ++nextId, currentGeneration = generation, currentPort = port;
        return new Promise((resolve, reject) => {
          const abort = () => { void stop().catch(() => {}); };
          const timer = setTimeout(failWorker, options.timeoutMs ?? (exclusive ? 120_000 : 60_000));
          pending.set(id, { generation: currentGeneration, exclusive, resolve, reject,
            removeAbort: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } });
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) { abort(); return; }
          try { currentPort.postMessage({ id, generation: currentGeneration, command }, transferOwned ? ownedBuffers(command) : []); }
          catch { failWorker(); }
        });
      } catch (error) { return Promise.reject(error instanceof CryptoError ? error : new CryptoError("sync-encryption-unsupported")); }
    },
    cancel: stop,
    close() { closed = true; return stop(); },
  };
  return owner;
}
