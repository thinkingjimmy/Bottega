/**
 * [INPUT]: Depends on immutable remote DTOs, scoped command reads/subscriptions and canonical content hashing.
 * [OUTPUT]: Provides exact retries and receipt reconciliation, including uncertain withdrawal recovery, retarget withdrawals that demand a fresh confirmation, and terminal draft release without an execution outbox.
 * [POS]: Shared CommandSink consumer; confirmed receipts or strict post-lookup rejections resolve transport uncertainty.
 */
import type { FrozenRemoteCommand } from "@ai-chat/cloud-protocol/remote/encrypted";
import { remoteIntentIdentity, remoteCommandInputSchema } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteAdmissionRejection } from "@ai-chat/cloud-protocol/remote/selection";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { RemoteCommand, RemoteCommandInput, RemoteCommandPort } from "../contracts";
export type RemoteEntry = { canonical?: boolean; replacementId?: string; retargetRequested?: boolean; reconfirmRequired?: boolean; withdrawnByUser?: boolean; frozen?: FrozenRemoteCommand; rejected?: RemoteAdmissionRejection; input: RemoteCommandInput; receipt: RemoteCommand | null; busy: boolean; uncertain: boolean; optimistic: boolean; owned: boolean };
export const awaitingRemoteAdmission = (entry: RemoteEntry) => entry.owned && !entry.canonical && !entry.rejected && !entry.receipt?.admission &&
  (entry.uncertain || !entry.receipt || !["expired", "rejected"].includes(entry.receipt.state));
type RemoteCommandView = { entries: RemoteEntry[]; error: boolean; more: boolean; loading: boolean };
const terminal = new Set(["done", "cancelled", "error", "expired", "rejected"]);
export const commandInput = (receipt: RemoteCommand): RemoteCommandInput => {
  const { commandId, chatId, incarnationId, targetDeviceId, executionEpoch, intent, payload } = receipt.command;
  return remoteCommandInputSchema.parse({ commandId, chatId, incarnationId, targetDeviceId, executionEpoch, ...(intent ? { intent } : {}), payload });
};
export class RemoteCommandSession {
  private state: RemoteCommandView = { entries: [], error: false, more: false, loading: false };
  private listeners = new Set<() => void>();
  private watches = new Map<string, () => void>();
  private pageStop: (() => void) | null = null;
  private cursor: string | null = null;
  private generation = 0;
  private watchGeneration = 0;
  private openState = false;
  private retargeting = false;
  constructor(private port: RemoteCommandPort, private chatId: string) {}
  bind(port: RemoteCommandPort) { this.port = port; }
  forget() { this.close(); this.publish({ entries: [], error: false, more: false, loading: false }); }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<RemoteCommandView>) {
    this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener();
  }
  private update(commandId: string, change: Partial<RemoteEntry>) {
    this.publish({ entries: this.state.entries.map(entry => entry.input.commandId === commandId ? { ...entry, ...change } : entry) });
  }
  private receive(receipt: RemoteCommand, ownInput?: RemoteCommandInput) {
    if (receipt.command.chatId !== this.chatId) throw new Error("REMOTE_RECEIPT_SCOPE");
    const input = commandInput(receipt), previous = this.state.entries.find(entry => entry.input.commandId === input.commandId);
    if (hashChatContent(remoteIntentIdentity(input)) !== hashChatContent(remoteIntentIdentity(ownInput ?? previous?.input ?? input))) throw new Error("REMOTE_RECEIPT_IDENTITY");
    if (previous?.receipt && (receipt.updatedAt < previous.receipt.updatedAt || terminal.has(previous.receipt.state) && !terminal.has(receipt.state))) return;
    const retargetRequested = previous?.retargetRequested && (!terminal.has(receipt.state) || receipt.state === "cancelled" || receipt.state === "rejected" && receipt.reason === "target-changed");
    const entry: RemoteEntry = { input: previous?.input ?? ownInput ?? input, receipt, canonical: previous?.canonical, frozen: previous?.frozen, replacementId: previous?.replacementId, retargetRequested, reconfirmRequired: previous?.reconfirmRequired, withdrawnByUser: previous?.withdrawnByUser, busy: previous?.busy ?? false, uncertain: false, optimistic: previous?.optimistic ?? false, owned: previous?.owned ?? false };
    this.publish({ entries: previous ? this.state.entries.map(value => value.input.commandId === input.commandId ? entry : value) : [...this.state.entries, entry] });
  }
  private watch(commandId: string) {
    if (!this.openState || this.watches.has(commandId)) return;
    const generation = this.watchGeneration;
    this.watches.set(commandId, this.port.watch(commandId, receipt => {
      if (generation !== this.watchGeneration || !receipt) return;
      try { this.receive(receipt); } catch { this.publish({ error: true }); }
    }, () => { if (generation === this.watchGeneration) this.publish({ error: true }); }));
  }
  open() {
    if (this.openState) return;
    this.openState = true; this.generation++; this.resubscribe();
  }
  resubscribe() {
    if (!this.openState) return;
    this.stopWatches(); const generation = this.watchGeneration;
    this.pageStop = this.port.watchPage(this.chatId, null, page => {
      if (generation !== this.watchGeneration) return;
      try {
        for (const receipt of page.items) this.receive(receipt);
        this.cursor = page.cursor; this.publish({ error: false, more: !page.complete, loading: false });
      } catch { this.publish({ error: true, loading: false }); }
    }, () => { if (generation === this.watchGeneration) this.publish({ error: true, loading: false }); });
    for (const entry of this.state.entries) this.watch(entry.input.commandId);
  }
  close() {
    this.openState = false; this.generation++; this.stopWatches();
    this.publish({ entries: this.state.entries.map(entry => ({ ...entry, busy: false, uncertain: entry.uncertain || entry.owned && !entry.receipt && !entry.rejected })) });
  }
  private stopWatches() {
    this.watchGeneration++; this.pageStop?.(); this.pageStop = null;
    for (const stop of this.watches.values()) stop(); this.watches.clear();
  }
  async more() {
    if (!this.state.more || !this.cursor || this.state.loading) return;
    const generation = this.generation, cursor = this.cursor; this.publish({ loading: true });
    try {
      const page = await this.port.page(this.chatId, cursor); if (generation !== this.generation) return;
      for (const receipt of page.items) { this.receive(receipt); this.watch(receipt.command.commandId); }
      this.cursor = page.cursor; this.publish({ more: !page.complete, error: false });
    } catch { if (generation === this.generation) this.publish({ error: true }); }
    finally { if (generation === this.generation) this.publish({ loading: false }); }
  }
  async submit(raw: RemoteCommandInput, signal?: AbortSignal) {
    if (signal?.aborted) return null;
    const input = remoteCommandInputSchema.parse(structuredClone(raw));
    if (input.chatId !== this.chatId) throw new Error("REMOTE_COMMAND_SCOPE");
    const previous = this.state.entries.find(entry => entry.input.commandId === input.commandId);
    if (previous && hashChatContent(previous.input) !== hashChatContent(input)) throw new Error("REMOTE_COMMAND_CHANGED");
    if (previous?.busy) return null;
    if (!previous) this.publish({ entries: [...this.state.entries, { input, receipt: null, busy: false, uncertain: false, optimistic: input.payload.kind === "start-turn", owned: true }] });
    this.watch(input.commandId);
    this.update(input.commandId, { busy: true }); const generation = this.generation;
    try {
      let frozen = this.state.entries.find(entry => entry.input.commandId === input.commandId)?.frozen;
      if (!frozen) { frozen = await this.port.prepare(input); if (generation !== this.generation) return null; this.update(input.commandId, { frozen }); }
      if (signal?.aborted) return null;
      const receipt = await this.port.submit(input, frozen);
      if (generation !== this.generation) return null;
      if ("rejected" in receipt) { this.update(input.commandId, { rejected: receipt.rejected, uncertain: false, optimistic: false }); return null; }
      this.receive(receipt, input); return receipt;
    } catch {
      if (generation === this.generation && !this.state.entries.find(entry => entry.input.commandId === input.commandId)?.receipt) this.update(input.commandId, { uncertain: true, rejected: undefined });
      return null;
    } finally { if (generation === this.generation) this.update(input.commandId, { busy: false }); }
  }
  async load(commandId: string) {
    if (this.state.entries.some(entry => entry.input.commandId === commandId)) return;
    const generation = this.generation, receipt = await this.port.get(commandId);
    if (generation === this.generation && receipt) { this.receive(receipt); this.watch(commandId); }
  }
  retry(commandId: string) {
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    return entry ? this.submit(entry.input) : Promise.resolve(null);
  }
  async retarget(targetDeviceId: string, executionEpoch: number) {
    if (this.retargeting) return;
    this.retargeting = true; const generation = this.generation;
    try { for (const entry of this.state.entries) {
      if (!entry.owned || entry.withdrawnByUser || entry.replacementId || entry.busy || entry.uncertain || entry.reconfirmRequired || !entry.input.intent || entry.input.targetDeviceId === targetDeviceId || entry.input.payload.kind !== "start-turn" || !entry.receipt) continue;
      // Full Access is scoped to its intended computer, and a file reference to the computer that holds it. Such an intent is withdrawn,
      // never moved: the consumer returns its text to the draft so the user re-sends with a new explicit confirmation.
      const reconfirm = entry.input.payload.permissionMode === "full-access" ||
        Boolean(entry.input.payload.references?.some(reference => reference.kind === "file" && reference.deviceId !== targetDeviceId));
      let receipt = entry.receipt;
      if (!receipt.withdrawalRequested && (receipt.state.startsWith("awaiting-") || ["delivered", "claimed", "accepted", "outcome-unknown"].includes(receipt.state))) {
        this.update(entry.input.commandId, { retargetRequested: true }); receipt = await this.withdraw(entry.input.commandId, true) ?? receipt;
        if (generation !== this.generation) return;
      }
      if (receipt.state === "cancelled" && !this.state.entries.find(value => value.input.commandId === entry.input.commandId)?.retargetRequested) continue;
      if (receipt.state !== "cancelled" && !(receipt.state === "rejected" && receipt.reason === "target-changed")) continue;
      if (receipt.admission && receipt.output?.kind !== "queue-withdrawal") continue;
      if (reconfirm) { this.update(entry.input.commandId, { retargetRequested: false, reconfirmRequired: true }); continue; }
      const commandId = crypto.randomUUID(); this.update(entry.input.commandId, { replacementId: commandId });
      await this.submit({ ...entry.input, commandId, targetDeviceId, executionEpoch });
    } } finally { this.retargeting = false; }
  }
  async withdraw(commandId: string, retarget = false) {
    if (!this.port.withdraw) return null;
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    if (!entry || entry.busy) return null;
    this.update(commandId, { busy: true, ...(!retarget ? { withdrawnByUser: true } : {}) });
    const generation = this.generation;
    try {
      const receipt = await this.port.withdraw(commandId);
      if (generation !== this.generation) return null;
      this.receive(receipt); return receipt;
    } catch { if (generation === this.generation) this.update(commandId, { uncertain: true }); return null; }
    finally { if (generation === this.generation) this.update(commandId, { busy: false }); }
  }
  async check(commandId: string) {
    const entry = this.state.entries.find(value => value.input.commandId === commandId);
    if (!entry || entry.busy) return;
    this.update(commandId, { busy: true }); const generation = this.generation;
    try {
      const receipt = await this.port.get(commandId);
      if (generation !== this.generation) return;
      if (receipt) this.receive(receipt, entry.input);
      else this.update(commandId, { uncertain: true });
    } catch { if (generation === this.generation) this.update(commandId, { uncertain: true }); }
    finally { if (generation === this.generation) this.update(commandId, { busy: false }); }
  }
  canonical = (commandIds: string[]) => {
    const ids = new Set(commandIds);
    if (this.state.entries.some(entry => !entry.canonical && ids.has(entry.input.commandId))) {
      this.publish({ entries: this.state.entries.map(entry => ids.has(entry.input.commandId) ? { ...entry, canonical: true, uncertain: false, optimistic: false } : entry) });
    }
  };
}
