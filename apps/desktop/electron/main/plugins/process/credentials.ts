/**
 * [INPUT]: Depends on the existing durable JSON owner and guarded native secureStorage encryption.
 * [OUTPUT]: Provides a trusted shared credential port and explicit adapters to existing Bottega credential owners.
 * [POS]: Main-only secret material; plugin revisions and source exports contain no credential bytes.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import { secureStorage } from "../../security/safe-storage";
export type PluginCredentialPort = { list(): Promise<string[]>; read(key: string): Promise<string | null>; write(key: string, value: string | null): Promise<void> };
const sources = new Map<string, Map<string, PluginCredentialPort>>();
const stores = new Set<PluginCredentialStore>();
export function attachBottegaCredentialSource(userData: string, namespace: string, source: PluginCredentialPort) {
  const profile = sources.get(userData) ?? new Map<string, PluginCredentialPort>();
  if (profile.has(namespace)) throw new Error(`Credential owner already attached: ${namespace}`);
  profile.set(namespace, source); sources.set(userData, profile);
  for (const store of stores) if (store.userData === userData) store.attach(namespace, source);
  return () => { if (profile.get(namespace) !== source) return; profile.delete(namespace); for (const store of stores) if (store.userData === userData) store.detach(namespace, source); };
}
export class PluginCredentialStore implements PluginCredentialPort {
  private readonly file;
  private readonly owners = new Map<string, PluginCredentialPort>();
  constructor(readonly userData: string) { this.file = new DurableJson(join(userData, "plugin-credentials.json"), z.object({ version: z.literal(1), slots: z.record(z.string(), z.string()) }).strict(), () => ({ version: 1 as const, slots: {} as Record<string, string> })); }
  initialize() { for (const [name, source] of sources.get(this.userData) ?? []) this.attach(name, source); stores.add(this); return this.file.initialize(); }
  async close() { stores.delete(this); this.owners.clear(); await this.file.closeAndFlush(); }
  attach(namespace: string, owner: PluginCredentialPort) { if (this.owners.has(namespace)) throw new Error(`Credential namespace already registered: ${namespace}`); this.owners.set(namespace, owner); }
  detach(namespace: string, owner: PluginCredentialPort) { if (this.owners.get(namespace) === owner) this.owners.delete(namespace); }
  private owner(key: string) { const split = key.indexOf(":"); return split > 0 ? { port: this.owners.get(key.slice(0, split)), key: key.slice(split + 1) } : null; }
  private async coldWidgets<T>(run: (state: import("../../system-dock/widgets/api/state/store").ApiStateStore) => T | Promise<T>, empty: T): Promise<T> {
    try { await readFile(join(this.userData, "dock-widget-api.json")); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return empty; throw cause; }
    const { ApiStateStore } = await import("../../system-dock/widgets/api/state/store");
    const state = new ApiStateStore(this.userData); await state.initialize();
    try { return await run(state); } finally { await state.close(); }
  }
  async list() {
    const names = [...Object.keys(this.file.read(state => state.slots)), ...(await Promise.all([...this.owners].map(async ([namespace, owner]) => (await owner.list()).map(key => `${namespace}:${key}`)))).flat()];
    if (!this.owners.has("widgets")) names.push(...await this.coldWidgets(state => state.owners().flatMap(owner => state.slots(owner).filter(slot => slot.set).map(slot => "widgets:" + Buffer.from(JSON.stringify({ owner, slotId: slot.slotId })).toString("base64url"))), [] as string[]));
    return names;
  }
  async read(key: string) {
    const owner = this.owner(key); if (owner?.port) return owner.port.read(owner.key);
    if (key.startsWith("widgets:")) {
      const { apiOwnerSchema } = await import("../../system-dock/widgets/api/state/model");
      const target = JSON.parse(Buffer.from(key.slice(8), "base64url").toString("utf8"));
      return this.coldWidgets(state => state.material(apiOwnerSchema.parse(target.owner), String(target.slotId)), null as string | null);
    }
    const cipher = this.file.read(state => Object.hasOwn(state.slots, key) ? state.slots[key] : undefined); return cipher ? secureStorage.decryptString(Buffer.from(cipher, "base64")) : null;
  }
  async write(key: string, value: string | null) {
    if (!/^[A-Za-z0-9_.:/%+-]{1,2048}$/.test(key) || value !== null && Buffer.byteLength(value) > 16_384) throw new Error("Invalid credential key or value");
    const owner = this.owner(key); if (owner?.port) return owner.port.write(owner.key, value);
    if (["widgets", "apps", "settings"].includes(key.split(":")[0]!) && key.includes(":")) throw new Error("This Bottega credential owner is not open for updates");
    const cipher = value === null ? null : secureStorage.encryptString(value).toString("base64");
    await this.file.mutate(state => { if (cipher === null) delete state.slots[key]; else state.slots = { ...state.slots, [key]: cipher }; });
  }
}
