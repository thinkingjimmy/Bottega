/**
 * [INPUT]: Depends on the durable JSON store, verified account identity and bounded source/receipt schemas.
 * [OUTPUT]: Provides PluginInstallRequests and its installed runtime accessor for owner-computer review.
 * [POS]: Durable request inbox only; remote callers cannot confirm, fetch package bytes or execute an installer.
 */
import { join } from "node:path";
import { z } from "zod";
import { pluginInstallSourceSchema, pluginInstallReceiptSchema, type PluginInstallSource, type NativePluginInstallRequest } from "@ai-chat/cloud-protocol/resources/plugin-install";
import { DurableJson } from "../../../persistence/durable-json";

const rowSchema = pluginInstallSourceSchema.extend(pluginInstallReceiptSchema.shape).extend({
  userId: z.string().min(1).max(128), sourceDeviceId: z.string().min(1).max(128), expiresAt: z.number().int().positive(),
}).strict();
const schema = z.object({ version: z.literal(1), rows: z.array(rowSchema).max(128) }).strict();
type Row = z.infer<typeof rowSchema>;
let account: () => string | null = () => null;
const installed: { current: PluginInstallRequests | null } = { current: null };
export const setPluginInstallAccount = (read: typeof account) => { account = read; };
export const pluginInstallRequests = () => installed.current;
const unavailable = () => new Error("plugin-request-unavailable");
export class PluginInstallRequests {
  private readonly store: DurableJson<z.infer<typeof schema>>;
  private readonly listeners = new Set<() => void>();
  constructor(userData: string) { this.store = new DurableJson(join(userData, "plugin-install-requests.json"), schema, () => ({ version: 1, rows: [] })); }
  async initialize() {
    await this.store.initialize();
    await this.store.mutate(state => { for (const row of state.rows) {
      if (row.state === "installing") row.state = "unknown";
      if (row.state === "reviewing") row.state = "waiting";
    } });
    installed.current = this;
  }
  onChanged(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  accountChanged() { this.changed(); }
  private changed() { for (const listener of this.listeners) { try { listener(); } catch { /* A closed window cannot block a receipt. */ } } }
  private receipt(row: Row) { return pluginInstallReceiptSchema.parse({ requestId: row.requestId,
    state: row.expiresAt <= Date.now() && ["waiting", "reviewing"].includes(row.state) ? "expired" : row.state }); }
  async request(input: { requestId: string; userId: string; sourceDeviceId: string; source: PluginInstallSource }) {
    if (account() !== input.userId) throw unavailable();
    const requestId = z.string().uuid().parse(input.requestId), source = pluginInstallSourceSchema.parse(input.source);
    await this.store.mutate(state => {
      if (account() !== input.userId) throw unavailable();
      const previous = state.rows.find(row => row.requestId === requestId && row.userId === input.userId);
      if (previous) {
        if (previous.sourceDeviceId !== input.sourceDeviceId || previous.repoUrl !== source.repoUrl || (previous.requestedRef ?? "") !== (source.requestedRef ?? "")
          || (previous.subdirectory ?? "") !== (source.subdirectory ?? "")) throw new Error("input-changed");
        return;
      }
      if (state.rows.filter(row => row.userId === input.userId && row.expiresAt > Date.now() && ["waiting", "reviewing", "installing"].includes(row.state)).length >= 20) throw new Error("plugin-request-limit");
      while (state.rows.length >= 128) {
        const index = state.rows.findIndex(row => row.state !== "installing" && (row.expiresAt < Date.now() || ["installed", "declined", "expired", "unknown"].includes(row.state)));
        if (index < 0) throw new Error("plugin-request-limit");
        state.rows.splice(index, 1);
      }
      state.rows.push({ ...source, requestId, userId: input.userId, sourceDeviceId: input.sourceDeviceId, expiresAt: Date.now() + 30 * 60_000, state: "waiting" });
    });
    this.changed();
    return this.status(input.requestId, input.userId, input.sourceDeviceId);
  }
  status(requestId: string, userId: string, sourceDeviceId: string) {
    if (account() !== userId) throw unavailable();
    const row = this.store.snapshot().rows.find(row => row.requestId === requestId && row.userId === userId && row.sourceDeviceId === sourceDeviceId);
    if (!row) throw unavailable();
    return this.receipt(row);
  }
  list(): NativePluginInstallRequest[] {
    return this.store.snapshot().rows.filter(row => row.userId === account() && row.expiresAt > Date.now() && ["waiting", "reviewing", "installing"].includes(row.state))
      .map(({ userId: _userId, ...row }) => row);
  }
  review(requestId: string) {
    const row = this.list().find(row => row.requestId === requestId);
    if (!row || !["waiting", "reviewing"].includes(row.state)) throw unavailable();
    return row;
  }
  async change(requestId: string, state: "reviewing" | "installing" | "declined", userId = account()) {
    await this.store.mutate(value => {
      const row = value.rows.find(row => row.requestId === requestId && row.userId === userId);
      if (!userId || account() !== userId || !row || row.expiresAt <= Date.now() ||
        !(state === "installing" ? row.state === "reviewing" : ["waiting", "reviewing"].includes(row.state))) throw unavailable();
      row.state = state;
    });
    this.changed();
  }
  /** A completed installer keeps its receipt even if account admission changed during the local operation. */
  async finish(requestId: string, userId: string, state: "installed" | "unknown") {
    await this.store.mutate(value => { const row = value.rows.find(row => row.requestId === requestId && row.userId === userId);
      if (!row || row.state !== "installing") throw unavailable(); row.state = state; });
    this.changed();
  }
  currentUser() { return account(); }
}
