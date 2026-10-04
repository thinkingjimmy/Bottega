/**
 * [INPUT]: Depends on Node crypto/path, the public port schemas and limits (@bottega/contracts/host/ports), durable JSON publication, the serial queue and the public RPC envelope
 * [OUTPUT]: Provides PackagePorts (and re-exports PACKAGE_PORT_LIMITS, isPackagePortOperation): per-package durable storage, contract-scoped
 *           events, background holds with held/release inspection, and settings.get through an attached package-and-host reader. Settings
 *           changed events name only the package's own hosts; host identity lets the runtime preserve each process-start snapshot.
 * [POS]: SDK-06 ports for host packages; a package names keys and contracts, never another package, and everything it holds in memory is released when its host exits
 */
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PACKAGE_PORT_INPUTS, PACKAGE_PORT_LIMITS, isPackagePortOperation, portJsonBytes, portStorageBytes, type PackageEvent, type PackagePortOperation } from "@bottega/contracts/host/ports";
import type { JsonValue } from "@ai-chat/cloud-protocol/contracts/canonical";
import { RPC_VERSION, type RpcRequest, type RpcResponse } from "@ai-chat/cloud-protocol/contracts/capabilities";
import { durableReplaceFile, isErrnoCode, quarantineDurableFile } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
import { SETTINGS_CONTRACT } from "@bottega/contracts/plugins/contracts";

export { PACKAGE_PORT_LIMITS, isPackagePortOperation, type PackagePortOperation };

type Caller = Readonly<{ hostId: string; installIdentity: string; provides: readonly string[]; requires: readonly string[] }>;
type Deliver = (hostId: string, event: PackageEvent) => void;
type Store = { version: 1; entries: Record<string, JsonValue> };

/* The publisher as one subscriber sees it: keyed by the subscriber, so its handles cannot be linked with another's, and never the
   publisher's install identity itself. */
const publisherHandle = (subscriber: string, publisher: string) => `pkg_${createHmac("sha256", subscriber).update(publisher).digest("hex").slice(0, 32)}`;

export class PackagePorts {
  private readonly queues = new Map<string, SerialQueue>();
  private readonly subscriptions = new Map<string, Map<string, string>>(); // contract → hostId → subscriber install identity
  private readonly holds = new Map<string, string>(); // hostId → reason
  private settingsReader: ((installIdentity: string, hostId: string) => Promise<JsonValue>) | null = null;

  constructor(private readonly root: string, private readonly deliver: Deliver) {}

  async dispatch(caller: Caller, request: RpcRequest): Promise<RpcResponse> {
    const failure = (code: Extract<RpcResponse, { ok: false }>["error"]["code"], message: string): RpcResponse =>
      ({ v: RPC_VERSION, id: request.id, ok: false, error: { code, message } });
    if (!isPackagePortOperation(request.operation)) return failure("unknown-operation", request.operation);
    const parsed = PACKAGE_PORT_INPUTS[request.operation].safeParse(request.input);
    if (!parsed.success) return failure("input-invalid", parsed.error.issues[0]?.message ?? "input invalid");
    try {
      const result = await this.run(caller, request.operation, parsed.data as never);
      return { v: RPC_VERSION, id: request.id, ok: true, result };
    } catch (cause) {
      return failure((cause as { code?: string }).code === "principal-denied" ? "principal-denied" : "operation-failed", (cause as Error).message);
    }
  }

  /** The host exited or was stopped: nothing it subscribed to or held survives it (P18, P19). */
  release(hostId: string) {
    this.holds.delete(hostId);
    for (const hosts of this.subscriptions.values()) hosts.delete(hostId);
  }

  held(hostId: string) { return this.holds.get(hostId) ?? null; }

  /** The plugin catalog answers settings.get: only the caller's own values, never another package's. */
  attachSettings(reader: (installIdentity: string, hostId: string) => Promise<JsonValue>) { this.settingsReader = reader; }
  /** Tells a package's own hosts which of its settings changed (Bottega is the publisher; no subscription needed). */
  settingsChanged(hostIds: readonly string[], ids: readonly string[]) {
    for (const hostId of hostIds) this.deliver(hostId, { contract: SETTINGS_CONTRACT, type: "changed", payload: { ids: [...ids] }, from: publisherHandle(hostId, "bottega") });
  }

  private async run(caller: Caller, operation: PackagePortOperation, input: Record<string, unknown>): Promise<JsonValue> {
    const denied = (message: string) => Object.assign(new Error(message), { code: "principal-denied" });
    switch (operation) {
      case "storage.get": return this.read(caller).then(store => store.entries[input.key as string] ?? null);
      case "storage.list": return this.read(caller).then(store => {
        const keys = Object.keys(store.entries).sort().filter(item => item.startsWith(input.prefix as string) && (!input.after || item > (input.after as string)));
        const page = keys.slice(0, PACKAGE_PORT_LIMITS.listPage);
        return { keys: page, next: keys.length > page.length ? page.at(-1)! : null };
      });
      case "storage.put": case "storage.delete": return this.mutate(caller, store => {
        if (operation === "storage.delete") { delete store.entries[input.key as string]; return null; }
        /* The input schema already refused anything but strict JSON; the limits use the public measures. */
        if (portJsonBytes(input.value) > PACKAGE_PORT_LIMITS.valueBytes) throw new Error("storage value exceeds 64 KiB");
        store.entries[input.key as string] = input.value as JsonValue;
        if (Object.keys(store.entries).length > PACKAGE_PORT_LIMITS.keys) throw new Error("storage key budget exceeded");
        if (portStorageBytes(store.entries) > PACKAGE_PORT_LIMITS.totalBytes) throw new Error("storage byte budget exceeded");
        return null;
      });
      case "events.subscribe": {
        if (!caller.requires.includes(input.contract as string)) throw denied("a package subscribes only to contracts it requires");
        const hosts = this.subscriptions.get(input.contract as string) ?? new Map<string, string>();
        if (hosts.size >= PACKAGE_PORT_LIMITS.subscribersPerContract && !hosts.has(caller.hostId)) throw new Error("subscription budget exceeded");
        this.subscriptions.set(input.contract as string, hosts.set(caller.hostId, caller.installIdentity));
        return null;
      }
      case "events.publish": {
        if (!caller.provides.includes(input.contract as string)) throw denied("a package publishes only on contracts it provides");
        if (portJsonBytes(input.payload) > PACKAGE_PORT_LIMITS.eventBytes) throw new Error("event exceeds 16 KiB");
        let delivered = 0;
        for (const [hostId, subscriber] of this.subscriptions.get(input.contract as string) ?? []) {
          if (hostId === caller.hostId) continue;
          this.deliver(hostId, { contract: input.contract as string, type: input.type as string, payload: input.payload as JsonValue, from: publisherHandle(subscriber, caller.installIdentity) });
          delivered++;
        }
        return { delivered };
      }
      case "background.hold": this.holds.set(caller.hostId, input.reason as string); return null;
      case "background.release": this.holds.delete(caller.hostId); return null;
      case "settings.get": if (!this.settingsReader) throw new Error("settings-unavailable"); return this.settingsReader(caller.installIdentity, caller.hostId);
    }
  }

  /* ── Storage: one durable file per package, keyed by a hash of its install identity (never by a name it chose). ── */
  private path(caller: Caller) {
    return join(this.root, `${createHash("sha256").update(caller.installIdentity).digest("hex")}.json`);
  }
  private queue(caller: Caller) {
    let queue = this.queues.get(caller.installIdentity);
    if (!queue) this.queues.set(caller.installIdentity, (queue = new SerialQueue()));
    return queue;
  }
  private async load(path: string): Promise<Store> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Store;
      if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") throw new Error("storage file invalid");
      return parsed;
    } catch (cause) {
      if (isErrnoCode(cause, "ENOENT")) return { version: 1, entries: {} };
      /* A torn file is kept as evidence; the package starts from empty instead of failing every call. */
      await quarantineDurableFile(path);
      return { version: 1, entries: {} };
    }
  }
  private read(caller: Caller) { return this.queue(caller).enqueue(() => this.load(this.path(caller))); }
  private mutate(caller: Caller, change: (store: Store) => JsonValue) {
    const path = this.path(caller);
    return this.queue(caller).enqueue(async () => {
      const store = await this.load(path);
      const result = change(store);
      await durableReplaceFile(path, `${JSON.stringify(store)}\n`, 0o600);
      return result;
    });
  }
}
