/**
 * [INPUT]: Depends on DurableJson, the workflow binding contract and resolveBinding from the Base binding contract.
 * [OUTPUT]: Provides WorkflowBindingStore: one durable file of this computer's workflow bindings, saved with a revision check, enabled/disabled by the user, removed with its Project (which is remembered until the account's copy is cleared), and suspended with a reason when its Base instance or a bound column no longer matches.
 * [POS]: workflows' binding truth, read by the run ledger before a run starts (F3/F4). It stores each role's configuration by id only; there are no revision copies — a run freezes the latest at start.
 */
import { join } from "node:path";
import { z } from "zod";
import { resolveBinding } from "@ai-chat/cloud-protocol/contracts/base/binding";
import type { BaseRef } from "@ai-chat/cloud-protocol/contracts/resources";
import { workflowBindingSchema, type WorkflowBinding } from "@ai-chat/cloud-protocol/contracts/workflow/binding";
import { DurableJson } from "../persistence/durable-json";

/* `removedProjects`: Projects whose bindings went with them and whose account copy (P13 projections) is not yet cleared. */
const fileSchema = z.object({ schemaVersion: z.literal(1), bindings: z.array(workflowBindingSchema).max(256),
  removedProjects: z.array(z.string().min(1).max(128)).max(256).default([]) }).strict();
type BindingFile = z.infer<typeof fileSchema>;
type BaseFacts = { ref: BaseRef; columns: readonly { id: string; type: string; workflow?: { role: string } }[] };

export class WorkflowBindingStore {
  private readonly file: DurableJson<BindingFile>;
  constructor(root: string) {
    this.file = new DurableJson(join(root, "bindings.json"), fileSchema, () => ({ schemaVersion: 1, bindings: [], removedProjects: [] }));
  }
  initialize() { return this.file.initialize(); }
  closeAndFlush() { return this.file.closeAndFlush(); }
  get(bindingId: string) { return this.file.read(state => state.bindings.find(item => item.bindingId === bindingId) ?? null); }
  list() { return this.file.read(state => state.bindings); }

  /** Creates or replaces a binding at `expectedRevision` (null for a new one); the stored revision moves by one. */
  save(next: Omit<WorkflowBinding, "revision" | "state" | "suspendedReason">, expectedRevision: number | null) {
    return this.file.mutate(state => {
      const index = state.bindings.findIndex(item => item.bindingId === next.bindingId);
      const current = index < 0 ? null : state.bindings[index]!;
      if ((current?.revision ?? null) !== expectedRevision) throw new Error("workflow-binding-revision-conflict");
      const saved = workflowBindingSchema.parse({ ...next, state: current?.state === "enabled" ? "enabled" : "draft", suspendedReason: null,
        revision: (current?.revision ?? -1) + 1 });
      if (index < 0) state.bindings.push(saved); else state.bindings[index] = saved;
      return saved;
    });
  }

  /**
   * The Project is deleted or removed: its bindings go with it (its runs are gone first, see runtime/project-lifecycle), and the
   * Project is remembered until the cloud outbox has cleared the account's copy.
   */
  removeProject(projectId: string) {
    return this.file.mutate(state => {
      state.bindings = state.bindings.filter(item => item.projectId !== projectId);
      state.removedProjects = [...state.removedProjects.filter(item => item !== projectId), projectId].slice(-256);
    });
  }
  removedProjects(): readonly string[] { return this.file.read(state => state.removedProjects); }
  acknowledgeRemoved(projectId: string) { return this.file.mutate(state => { state.removedProjects = state.removedProjects.filter(item => item !== projectId); }); }

  /** The user turns a binding on or off. Enabling re-checks the Base first, so a broken binding cannot be switched on (F4). */
  setEnabled(bindingId: string, enabled: boolean, base: BaseFacts) {
    return this.file.mutate(state => {
      const binding = state.bindings.find(item => item.bindingId === bindingId);
      if (!binding) throw new Error("workflow-binding-not-found");
      const resolved = enabled ? resolveBinding(binding.base, base) : null;
      Object.assign(binding, resolved?.state === "suspended" ? { state: "suspended", suspendedReason: resolved.reasons[0]! }
        : { state: enabled ? "enabled" : "disabled", suspendedReason: null }, { revision: binding.revision + 1 });
      return structuredClone(binding);
    });
  }

  /** Called when a bound Base changes: an enabled binding whose instance or columns no longer match is suspended with the reason. */
  reconcile(bindingId: string, base: BaseFacts) {
    return this.file.mutate(state => {
      const binding = state.bindings.find(item => item.bindingId === bindingId);
      if (!binding || binding.state !== "enabled") return binding ? structuredClone(binding) : null;
      const resolved = resolveBinding(binding.base, base);
      if (resolved.state === "suspended") Object.assign(binding, { state: "suspended", suspendedReason: resolved.reasons[0]!, revision: binding.revision + 1 });
      return structuredClone(binding);
    });
  }
}
