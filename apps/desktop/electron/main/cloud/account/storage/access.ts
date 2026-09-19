/**
 * [INPUT]: Depends on closed credential failure codes and operation generations.
 * [OUTPUT]: Provides shared process-local storage admission and sanitized failure classification.
 * [POS]: Single storage latch shared by early restoration, account service, login and token reads.
 */
import type { CloudError } from "../../../../../shared/cloud-ipc";
import { ChangeNotifier } from "../../runtime/notifier";
const credentialErrors = {
  "credential-encryption-unavailable": "encryption-unavailable",
  "credential-decryption-failed": "credentials-unreadable",
  "credential-file-invalid": "credentials-invalid",
  "credential-environment-mismatch": "credentials-environment-mismatch",
  "credential-read-failed": "credentials-unreadable",
  "credential-write-failed": "secure-save-failed",
} as const;
type CredentialFailure = keyof typeof credentialErrors;
export function credentialFailure(error: unknown): CredentialFailure | null {
  const code = error instanceof Error ? error.message : "";
  return Object.hasOwn(credentialErrors, code) ? code as CredentialFailure : null;
}
export function credentialError(error: unknown): CloudError {
  const code = credentialFailure(error); return code ? credentialErrors[code] : null;
}
export class StorageSuperseded extends Error {
  constructor() { super("cloud-request-superseded"); }
}
export class CredentialAccess {
  private epoch = 0;
  private held = false;
  private fault: CredentialFailure | null = null;
  private nativeUnavailable = false;
  private readonly listeners = new ChangeNotifier();
  get generation() { return this.epoch; }
  get blocked() { return this.fault; }
  get frozen() { return this.held; }
  get error() { return this.fault ? credentialErrors[this.fault] : null; }
  subscribe = this.listeners.subscribe;
  private changed() { this.listeners.notify(); }
  assert(generation = this.epoch, retry = false) {
    if (generation !== this.epoch || this.held) throw new StorageSuperseded();
    if (this.fault && !retry) throw new Error(this.fault);
  }
  fail(error: unknown, generation: number) {
    const code = credentialFailure(error);
    if (!code || generation !== this.epoch || this.held) return;
    if (code === "credential-encryption-unavailable") this.nativeUnavailable = true;
    if (this.fault === code) return;
    this.fault = code; this.changed();
  }
  recovered(generation: number) {
    this.assert(generation, true); this.fault = null; this.changed();
  }
  freeze() { this.held = true; this.epoch++; this.changed(); }
  discarded() {
    this.epoch++; this.held = false;
    this.fault = this.nativeUnavailable ? "credential-encryption-unavailable" : null;
    this.changed();
  }
}
