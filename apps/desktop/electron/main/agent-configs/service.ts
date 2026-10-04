/**
 * [INPUT]: Depends on account-scoped AgentConfigStore, payload parsing/freezing, local inventories and Provider defaults.
 * [OUTPUT]: Provides AgentConfigService: editable account configurations, login-independent workflow IDs with preserved Provider edits, resource-aware freeze and version-scoped apply reports.
 * [POS]: Agent-configs service boundary for IPC, workflow setup and run creation.
 */
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { freezeAgentConfig, offeredIn, parseAgentConfigPayload, type AgentConfigPayload, type ProviderDefaults } from "@ai-chat/cloud-protocol/agent-config/payload";
import type { ProviderDescriptor } from "@ai-chat/cloud-protocol/contracts/provider";
import type { AgentConfigView } from "@ai-chat/cloud-protocol/agent-config/bridge";
import type { ConfigApplySetting } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import { activeRecords, effectiveOf, type AgentConfigRecord, type AgentConfigStore } from "./store";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import { agentConfigTemplateScope } from "@ai-chat/cloud-protocol/agent-config/payload";
import type { AgentConfigInventory } from "@ai-chat/cloud-protocol/agent-config/payload";
export type { AgentConfigView };

export type AgentConfigPorts = { now(): number; liveProjectIds(): ReadonlySet<string>; descriptorFor(providerId: string): ProviderDescriptor | null;
  defaultsFor(providerId: string): ProviderDefaults;
  inventory?(projectId?: string): AgentConfigInventory;
  /** Whether this Provider's plugin is on (Q29); absent means always on. */
  providerEnabled?(providerId: string): boolean;
  /** The effective guarantees on this computer (its sandbox and this Provider's measured evidence). */
  guaranteesFor?(payload: AgentConfigPayload): AgentConfigView["guarantees"] };

const digestOf = (payload: AgentConfigPayload) => createHash("sha256").update(canonicalJson(payload)).digest("hex");

/* The bridge promises stable codes: a payload the schema refuses is `agent-config-invalid`; the budget keeps its own code. */
function parse(payload: unknown) {
  try { return parseAgentConfigPayload(payload); }
  catch (cause) { throw new Error(cause instanceof Error && cause.message === "agent-config-budget" ? "agent-config-budget" : "agent-config-invalid"); }
}

/** How many frozen versions keep the digest they were frozen from, for their late verdicts; the oldest is forgotten first. */
export const FROZEN_JUDGEMENT_LIMIT = 256;
const judgementKey = (frozen: unknown) => {
  const value = frozen as { configId?: unknown; revision?: unknown; ciphertextHash?: unknown } | null;
  return value && typeof value.configId === "string" && typeof value.revision === "number" && typeof value.ciphertextHash === "string"
    ? { configId: value.configId, key: `${value.configId}\0${value.revision}\0${value.ciphertextHash}` } : null;
};

export class AgentConfigService {
  private uploadTarget = false;
  /* T21-c: the last check's partial apply per configuration, for the exact payload it judged (by digest); memory only. */
  private readonly applyIssues = new Map<string, { digest: string; settings: readonly ConfigApplySetting[] }>();
  /* R03: the payload digest each frozen version (configId, revision, ciphertext hash) was frozen from; a verdict names its version. */
  private readonly judged = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly store: AgentConfigStore, private readonly ports: AgentConfigPorts) {}
  private ownerScope: (() => string | null) | null = null;
  /** Set by sync: which account a configuration made now belongs to (C-01); without sync, none. */
  setOwnerScope(owner: (() => string | null) | null) { this.ownerScope = owner; }
  /** Set by sync: with no account to upload to, every configuration is local-only and nothing is pending. */
  setUploadTarget(present: boolean) {
    if (present === this.uploadTarget) return;
    this.uploadTarget = present;
    this.refreshViews();
  }
  /**
   * T21-c: admission or preflight found some of the frozen version's settings would not take effect here (null: all apply). R03:
   * the verdict counts only for the payload that was frozen and only while it is still the configuration's current one, so a late
   * verdict about an earlier version (a run's, or a preflight that settled after an edit) neither marks nor clears the edited one;
   * a frozen version this process does not remember is ignored. The view already compares against the current digest.
   */
  reportApply(frozen: unknown, settings: readonly ConfigApplySetting[] | null) {
    const judgement = judgementKey(frozen), digest = judgement ? this.judged.get(judgement.key) : undefined;
    if (!judgement || !digest) return;
    const { configId } = judgement;
    const record = this.active(configId), payload = record ? effectiveOf(record).payload : null;
    if (!payload || digestOf(payload) !== digest) return;
    const before = this.applyIssues.get(configId);
    if (!settings?.length) this.applyIssues.delete(configId);
    else this.applyIssues.set(configId, { digest, settings: [...settings] });
    if (JSON.stringify(before ?? null) !== JSON.stringify(this.applyIssues.get(configId) ?? null)) this.refreshViews();
  }
  /** Something a view is computed from changed outside the store (the upload target, this computer's measurements). */
  refreshViews() { for (const listener of this.listeners) listener(); }
  private readonly view = (record: AgentConfigRecord): AgentConfigView => {
    const effective = effectiveOf(record);
    const syncIssue = record.pending?.state === "refused" ? "budget" as const : null;
    return { configId: record.configId, revision: record.pending?.revision ?? record.head?.revision ?? 0, payload: effective.payload,
      producerClass: effective.producerClass, deleted: effective.deleted, pending: effective.pending && this.uploadTarget && !syncIssue, localOnly: !this.uploadTarget,
      syncIssue: this.uploadTarget ? syncIssue : null,
      conflicted: record.conflict !== null,
      unavailable: effective.payload && this.ports.providerEnabled?.(effective.payload.provider) === false ? "provider-disabled" : null,
      guarantees: effective.payload && !effective.deleted ? this.ports.guaranteesFor?.(effective.payload) ?? null : null,
      applyIssue: this.applyIssueOf(record.configId, effective.payload) };
  };
  private applyIssueOf(configId: string, payload: AgentConfigPayload | null) {
    const issue = this.applyIssues.get(configId);
    return issue && payload && issue.digest === digestOf(payload) ? { kind: "partial" as const, settings: issue.settings } : null;
  }
  onChanged(listener: () => void) {
    const release = this.store.onChanged(listener); this.listeners.add(listener);
    return () => { release(); this.listeners.delete(listener); };
  }
  /* Only this account's configurations (and ones made signed out) are shown, offered or run; another account's wait on disk (C-01). */
  private owner() { return this.ownerScope ? this.ownerScope() : this.store.snapshot().scopeKey; }
  list() { return activeRecords({ ...this.store.snapshot(), scopeKey: this.owner() }).map(this.view); }
  /** A step picker's candidates in a Project: live, not deleted, offered there. Drafts are listed; running them is refused (A1). */
  offeredIn(projectId: string) {
    const live = this.ports.liveProjectIds();
    return this.list().filter(item => !item.deleted && item.payload && offeredIn(item.payload, projectId, live));
  }
  /* Saving on a desktop is the owner's action, so it writes an enabled (`desktop`) record; phones and browsers write drafts. */
  async create(payload: unknown) {
    return this.view(await this.store.edit(randomUUID(), { payload: parse(payload), producerClass: "desktop" }, this.owner()));
  }
  /** Account ownership scopes stable template IDs, including defaults created before sign-in. Edited Provider slots stay intact. */
  async workflowDefaults(provider: string, labels: Record<WorkflowRoleName, { name: string; instructions: string }>, persist = false, projectId?: string) {
    const owner = this.owner();
    const roles = ["plan", "develop", "review"] as const;
    return Promise.all(roles.map(async role => {
      const existing = this.list().find(view => view.payload?.provider === provider && view.payload.workflowTemplate === role);
      let configId = existing?.configId;
      for (let slot = 0; !configId; slot++) {
        const candidate = `workflow-${createHash("sha256").update(JSON.stringify(["plan-develop-review", provider, role, slot])).digest("hex").slice(0, 40)}`;
        const record = this.store.read(candidate, owner), current = record && effectiveOf(record);
        // A Provider edit vacates this template slot, but a deliberate deletion remains a refusal.
        if (!current || current.deleted || current.payload?.provider === provider && current.payload.workflowTemplate === role) configId = candidate;
      }
      const inherit = { mode: "inherit" } as const;
      const payload = parseAgentConfigPayload({ schemaVersion: 1, ...labels[role], purpose: "", provider, workflowTemplate: role,
        instructions: { mode: "explicit", value: labels[role].instructions }, model: inherit, reasoningEffort: inherit,
        permissionMode: { mode: "explicit", value: role === "develop" ? "approve-for-me" : "ask-for-approval" },
        ...agentConfigTemplateScope(role === "develop" ? "read-write" : "read"), memory: inherit,
        resourceSlots: [], availableIn: "all", guarantees: { workspace: role === "develop" ? "write" : "read-only", network: "on" } });
      if (persist) await this.store.edit(configId, { payload, producerClass: "desktop" }, owner, true);
      if (this.store.read(configId, owner)) return { role, configId, result: this.freeze(configId, role, projectId) };
      return { role, configId, result: freezeAgentConfig({
        head: { configId, configSchemaVersion: 1, revision: 1, ciphertextHash: digestOf(payload), plaintextBytes: 0, storedBytes: 0,
          writerDeviceId: "local", producerClass: "desktop", tombstone: false, updatedAt: this.ports.now() },
        payload, defaults: this.ports.defaultsFor(provider), descriptor: this.ports.descriptorFor(provider), now: this.ports.now(),
        providerEnabled: this.ports.providerEnabled?.(provider), role, inventory: this.ports.inventory?.(projectId),
      }) };
    }));
  }
  async update(configId: string, payload: unknown) {
    this.existing(configId);
    return this.view(await this.store.edit(configId, { payload: parse(payload), producerClass: "desktop" }, this.owner()));
  }
  /** Turns a draft (from a phone or browser) into a runnable record without changing its contents. */
  async enable(configId: string) {
    const effective = effectiveOf(this.existing(configId));
    if (effective.producerClass === "desktop") return this.view(this.existing(configId));
    return this.view(await this.store.edit(configId, { payload: effective.payload, producerClass: "desktop" }, this.owner()));
  }
  async remove(configId: string) { this.existing(configId); return this.view(await this.store.edit(configId, { payload: null, producerClass: "desktop" }, this.owner())); }
  /**
   * Resolves once for a run and returns a value that never changes afterwards (A5). An unsynced local edit on this computer
   * runs as what the user last saved here; its identity is the digest of those exact bytes.
   */
  freeze(configId: string, role?: WorkflowRoleName, projectId?: string) {
    const record = this.active(configId);
    if (!record) return { ok: false as const, reason: "agent-config-deleted" as const };
    const effective = effectiveOf(record);
    const local = effective.pending;
    const revision = local ? (record.queued ? (record.pending?.revision ?? record.head?.revision ?? 0) + 1 : record.pending!.revision) : record.head?.revision ?? 0;
    const hash = local ? (effective.payload ? createHash("sha256").update(canonicalJson(effective.payload)).digest("hex") : null) : record.head?.ciphertextHash ?? null;
    const head = revision > 0 ? { configId, configSchemaVersion: 1, revision, ciphertextHash: hash, plaintextBytes: 0, storedBytes: 0,
      writerDeviceId: "local", producerClass: effective.producerClass, tombstone: effective.deleted, updatedAt: this.ports.now() } : null;
    const provider = effective.payload?.provider ?? "";
    const frozen = freezeAgentConfig({ head, payload: effective.payload, providerEnabled: this.ports.providerEnabled?.(provider), defaults: this.ports.defaultsFor(provider),
      descriptor: this.ports.descriptorFor(provider), now: this.ports.now(), role, inventory: this.ports.inventory?.(projectId) });
    const judgement = frozen.ok ? judgementKey(frozen.frozen) : null;
    if (judgement && effective.payload) {
      this.judged.delete(judgement.key);
      this.judged.set(judgement.key, digestOf(effective.payload));
      while (this.judged.size > FROZEN_JUDGEMENT_LIMIT) this.judged.delete(this.judged.keys().next().value!);
    }
    if (!frozen.ok && effective.payload && ["agent-config-skill-unavailable", "agent-config-mcp-unavailable", "agent-config-mcp-read-only"].includes(frozen.reason)) {
      this.applyIssues.set(configId, { digest: digestOf(effective.payload),
        settings: [frozen.reason === "agent-config-skill-unavailable" ? "skills" : "tools"] });
      this.refreshViews();
    }
    return frozen;
  }
  private active(configId: string) {
    return this.store.read(configId, this.owner());
  }
  private existing(configId: string) {
    const record = this.active(configId);
    if (!record) throw new Error("agent-config-not-found");
    if (effectiveOf(record).deleted) throw new Error("agent-config-deleted");
    return record;
  }
}
