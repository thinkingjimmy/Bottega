/**
 * [INPUT]: Closed worker jobs, fixed WASM backend and scoped encryption operations.
 * [OUTPUT]: Pipelined dedicated-worker endpoint with exclusive key changes and private root-key ownership, including a worker-to-worker key handoff (unlock-handoff / adopt-key) the page thread only relays ports for.
 * [POS]: Worker entry implementation; host application event loops import only the owner.
 */
import { assertCrypto, assertExpectedScope, CRYPTO_ERROR_CODES, CryptoError, cryptoFailure, fingerprintKeyPackage, parseKeyPackage, VAULT_KEY_BYTES,
  type CryptoErrorCode, type CryptoScope, type KeyPackageFingerprint } from "@ai-chat/cloud-protocol/encryption";
import { skillSlugIdentityBytes } from "@ai-chat/cloud-protocol/skills/identity";
import { loadWasmBackend, type CryptoBackend } from "./engine/backend";
import { createVault, decryptContent, encryptContent, unlockVault, type UnlockedVault } from "./engine/operations";
import type { CryptoCommand, CryptoResult, CryptoWorkerEndpoint } from "./model";
import { ownedBuffers } from "./buffers";

export function serveCryptoWorker(endpoint: CryptoWorkerEndpoint): void {
  let backend: CryptoBackend | undefined, vault: UnlockedVault | undefined, exclusive = false, running = 0;
  const initializing = loadWasmBackend(); void initializing.catch(() => {});
  const lock = () => { vault?.key.fill(0); vault = undefined; };
  const run = async (command: CryptoCommand): Promise<CryptoResult> => {
    if (command.kind === "lock") { lock(); return { kind: "locked" }; }
    if (command.kind === "status") { backend ??= await initializing; return { kind: "status", unlocked: vault !== undefined, scope: vault?.scope ?? null, evidence: backend.evidence() }; }
    if (command.kind === "import-local-key") {
      assertCrypto(vault === undefined, "sync-operation-busy");
      const keyPackage = parseKeyPackage(command.keyPackage), fingerprint = fingerprintKeyPackage(command.keyPackage);
      assertExpectedScope(keyPackage.scope, command.expectedScope);
      assertCrypto(fingerprint === command.expectedFingerprint, "sync-space-changed");
      backend ??= await initializing;
      vault = { scope: keyPackage.scope, fingerprint, key: command.rootKey.slice() };
      return { kind: "unlocked", scope: vault.scope, fingerprint, evidence: backend.evidence() };
    }
    if (command.kind === "unlock-handoff") {
      // The one-shot KDF worker: derive, hand the key to the long-lived worker over its port, keep nothing (C-23).
      backend ??= await initializing;
      let derived: UnlockedVault;
      try { derived = unlockVault(backend, command.password, command.keyPackage, command.expectedScope, command.expectedFingerprint); }
      catch (error) { command.port.postMessage({ ok: false, error: cryptoFailure(error) }); command.port.close(); throw error; }
      const key = derived.key.slice(); derived.key.fill(0);
      command.port.postMessage({ ok: true, scope: derived.scope, fingerprint: derived.fingerprint, key }, [key.buffer]);
      command.port.close();
      return { kind: "handed-off", scope: derived.scope, fingerprint: derived.fingerprint, evidence: backend.evidence() };
    }
    if (command.kind === "adopt-key") {
      assertCrypto(vault === undefined, "sync-operation-busy");
      backend ??= await initializing;
      const message = await new Promise<unknown>(resolve => { command.port.addEventListener("message", event => resolve(event.data), { once: true }); command.port.start?.(); });
      command.port.close();
      const handed = message as { ok?: unknown; error?: unknown; scope?: CryptoScope; fingerprint?: KeyPackageFingerprint; key?: unknown };
      if (handed?.ok !== true) throw new CryptoError(CRYPTO_ERROR_CODES.includes(handed?.error as CryptoErrorCode) ? handed.error as CryptoErrorCode : "sync-encryption-unsupported");
      try {
        assertCrypto(handed.key instanceof Uint8Array && handed.key.byteLength === VAULT_KEY_BYTES && handed.scope !== undefined && typeof handed.fingerprint === "string");
        assertExpectedScope(handed.scope, command.expectedScope);
        assertCrypto(command.expectedFingerprint === null || handed.fingerprint === command.expectedFingerprint, "sync-space-changed");
      } catch (error) { if (handed.key instanceof Uint8Array) handed.key.fill(0); throw error; }
      vault = { scope: handed.scope, fingerprint: handed.fingerprint, key: handed.key };
      return { kind: "unlocked", scope: vault.scope, fingerprint: vault.fingerprint, evidence: backend.evidence() };
    }
    if (command.kind === "create" || command.kind === "unlock") {
      assertCrypto(vault === undefined, "sync-operation-busy");
      backend ??= await initializing;
      if (command.kind === "create") {
        const created = createVault(backend, command.password, command.source);
        vault = created.vault;
        return { kind: "created", scope: vault.scope, keyPackage: created.keyPackage, fingerprint: vault.fingerprint, evidence: backend.evidence() };
      }
      vault = unlockVault(backend, command.password, command.keyPackage, command.expectedScope, command.expectedFingerprint);
      return { kind: "unlocked", scope: vault.scope, fingerprint: vault.fingerprint, evidence: backend.evidence() };
    }
    assertCrypto(vault && backend, "sync-locked");
    if (command.kind === "skill-slug-key") {
      assertExpectedScope(vault.scope, command.expectedScope);
      const key = backend.subkey(vault.key, 7), message = skillSlugIdentityBytes(command.normalizedSlug);
      let mac: Uint8Array | undefined;
      try {
        mac = backend.authenticate(message, key);
        return { kind: "skill-slug-key", slugKey: Array.from(mac, byte => byte.toString(16).padStart(2, "0")).join("") };
      } finally { key.fill(0); message.fill(0); mac?.fill(0); }
    }
    if (command.kind === "export-local-key") {
      assertExpectedScope(vault.scope, command.expectedScope);
      assertCrypto(vault.fingerprint === command.expectedFingerprint, "sync-space-changed");
      return { kind: "exported-local-key", scope: vault.scope, fingerprint: vault.fingerprint, rootKey: vault.key.slice() };
    }
    if (command.kind === "encrypt") return { kind: "encrypted", ...encryptContent(backend, vault, command.context, command.plaintext) };
    return { kind: "decrypted", plaintext: decryptContent(backend, vault, command.expectedContext, command.envelope) };
  };
  endpoint.onMessage(async request => {
    if (!Number.isSafeInteger(request?.id) || !Number.isSafeInteger(request?.generation) || request.id < 1 || request.generation < 0) return;
    const { id, generation } = request;
    const changesKey = ["create", "unlock", "unlock-handoff", "adopt-key", "import-local-key", "lock"].includes(request.command.kind);
    if (exclusive || changesKey && running > 0) { endpoint.postMessage({ id, generation, ok: false, error: "sync-operation-busy" }); return; }
    if (changesKey) exclusive = true;
    running++;
    let result: CryptoResult | undefined;
    try { result = await run(request.command); endpoint.postMessage({ id, generation, ok: true, result }, ownedBuffers(result)); }
    catch (error) { endpoint.postMessage({ id, generation, ok: false, error: cryptoFailure(error) }); }
    finally {
      const command = request.command;
      if (command?.kind === "create" || command?.kind === "unlock" || command?.kind === "unlock-handoff") command.password = "";
      if (command?.kind === "encrypt" && command.plaintext instanceof Uint8Array) command.plaintext.fill(0);
      if (command?.kind === "import-local-key" && command.rootKey instanceof Uint8Array) command.rootKey.fill(0);
      if (result?.kind === "decrypted" && result.plaintext.byteLength) result.plaintext.fill(0);
      if (result?.kind === "exported-local-key" && result.rootKey.byteLength) result.rootKey.fill(0);
      if (changesKey) exclusive = false;
      running--;
    }
  });
}
