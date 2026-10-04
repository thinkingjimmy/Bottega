/**
 * [INPUT]: Depends on Zod, payload budgets, Provider descriptors, field schemas and named workflow freeze refusals.
 * [OUTPUT]: Provides AgentConfigPayload, template scope, local inventory and frozen resources; explicit Skill/MCP ids pin digests, missing ids refuse, read-only roles reject MCP and cap Base to read.
 * [POS]: Encrypted account configuration plaintext and immutable run snapshot contract; secrets and native paths stay local.
 */
import { z } from "zod";
import { canonicalJson } from "../encryption/encoding";
import { id } from "../encryption/domains/scalars";
import { permissionModeSchema, turnOptionValueSchema } from "../chats/options";
import { providerIdSchema, type AppliesAt, type ProviderDescriptor } from "../contracts/provider";
import type { FreezeRefusal } from "@bottega/contracts/workflow/bridge";
import { AGENT_CONFIG_LIMITS, type AgentConfigHead } from "./model";

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const text = (max: number) => z.string().refine(value => bytes(value) <= max, "agent-config-field-budget");
export const AGENT_CONFIG_PAYLOAD_LIMITS = Object.freeze({ nameBytes: 256, purposeBytes: 2_048, instructionsBytes: 16_384,
  skills: 32, tools: 64, slots: 16, availableProjects: 200, totalBytes: AGENT_CONFIG_LIMITS.plaintextBytes });
const L = AGENT_CONFIG_PAYLOAD_LIMITS;

/* Three states, never inferred from emptiness (A3): inherit takes the computer's Provider default for this field, reset
   sends nothing so the Provider's own default applies, explicit is the value — an explicit empty list is an empty list. */
const field = <T extends z.ZodType>(value: T) => z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit") }).strict(),
  z.object({ mode: z.literal("reset") }).strict(),
  z.object({ mode: z.literal("explicit"), value }).strict(),
]);
const unique = <T>(key: (item: T) => string) => (items: T[]) => new Set(items.map(key)).size === items.length;
const skills = z.array(z.object({ skillId: id }).strict()).max(L.skills).refine(unique<{ skillId: string }>(item => item.skillId), "agent-config-duplicate-skill");
const tools = z.array(z.object({ toolId: z.string().min(1).max(128) }).strict()).max(L.tools).refine(unique<{ toolId: string }>(item => item.toolId), "agent-config-duplicate-tool");
/* R-40: Skills select local library ids; tools retain the Base/Chat scope and optionally select local MCP server ids. */
export const AGENT_CONFIG_SKILLS_SCOPE = "none";
const baseScope = z.enum(["read", "read-write"]);
const mcpServers = z.array(z.object({ serverId: z.string().min(1).max(128) }).strict()).max(L.tools)
  .refine(unique<{ serverId: string }>(item => item.serverId), "agent-config-duplicate-mcp");
const toolsScope = z.object({ base: baseScope, chats: z.literal("linked"), mcpServers: mcpServers.optional() }).strict();
export type AgentConfigToolsScope = z.infer<typeof toolsScope>;
/** The scope a template writes: Developer and a blank config may write the Base, Planner and Reviewer only read it. */
export const agentConfigTemplateScope = (base: AgentConfigToolsScope["base"]) => ({
  skills: { mode: "explicit" as const, value: AGENT_CONFIG_SKILLS_SCOPE as typeof AGENT_CONFIG_SKILLS_SCOPE },
  tools: { mode: "explicit" as const, value: { base, chats: "linked" as const } },
});
/* Resource slots are the structure a run fills (a Base, a Project folder, a document); they are not overridable values. */
const slots = z.array(z.object({ slotId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), kind: z.enum(["base", "project-folder", "document"]),
  label: text(256).pipe(z.string().min(1)), required: z.boolean() }).strict()).max(L.slots).refine(unique<{ slotId: string }>(item => item.slotId), "agent-config-duplicate-slot");
/* Where the configuration is offered; a filter for pickers only, never a grant (A6). */
const availableIn = z.union([z.literal("all"), z.object({ projects: z.array(id).min(1).max(L.availableProjects)
  .refine(unique<string>(value => value), "agent-config-duplicate-project") }).strict()]);

export const agentConfigPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  name: text(L.nameBytes).pipe(z.string().min(1)),
  purpose: text(L.purposeBytes),
  provider: providerIdSchema,
  /** Identifies the built-in role defaults across devices; edits preserve this identity. */
  workflowTemplate: z.enum(["plan", "develop", "review"]).optional(),
  instructions: field(text(L.instructionsBytes)),
  model: field(turnOptionValueSchema),
  reasoningEffort: field(turnOptionValueSchema),
  permissionMode: field(permissionModeSchema),
  skills: field(z.union([skills, z.literal(AGENT_CONFIG_SKILLS_SCOPE)])),
  tools: field(z.union([tools, toolsScope])),
  /* A Memory request stays behind the existing Memory consent; asking is not granting. */
  memory: field(z.object({ read: z.boolean(), write: z.boolean() }).strict()),
  resourceSlots: slots,
  availableIn,
  /* What the configuration asks to be guaranteed (04 §5): a read-only workspace, no network. Asking is not having: the
     effective guarantee depends on the Provider, its version and the computer that runs it (effectiveGuarantees). */
  guarantees: z.object({ workspace: z.enum(["read-only", "write"]), network: z.enum(["on", "off"]) }).strict(),
}).strict();
export type AgentConfigPayload = z.infer<typeof agentConfigPayloadSchema>;
export const AGENT_CONFIG_FIELDS = ["instructions", "model", "reasoningEffort", "permissionMode", "skills", "tools", "memory"] as const;
export type AgentConfigField = (typeof AGENT_CONFIG_FIELDS)[number];

/** Parses and measures the whole record in UTF-8 bytes of its canonical JSON, the bytes that get sealed (A4). */
export function parseAgentConfigPayload(value: unknown): AgentConfigPayload {
  const payload = agentConfigPayloadSchema.parse(value);
  if (bytes(canonicalJson(payload)) > L.totalBytes) throw new Error("agent-config-budget");
  return payload;
}

/* A field the Provider descriptor names takes its declared timing (only its config fields are read, so a renderer passes a catalog
   snapshot entry as it is); the rest are fixed: instructions, Skills, Tools and the
   Memory request are handed to a new native session; the Provider itself is a different process. */
const DESCRIPTOR_FIELD: Partial<Record<AgentConfigField, string>> = { model: "model", reasoningEffort: "reasoning-effort",
  permissionMode: "permission-mode", tools: "mcp-servers" };
const FIXED_APPLIES_AT: Record<AgentConfigField, AppliesAt> = { instructions: "session-create", model: "next-turn", reasoningEffort: "next-turn",
  permissionMode: "next-turn", skills: "session-create", tools: "session-create", memory: "session-create" };
export function appliesAtFor(fieldName: AgentConfigField, descriptor: Pick<ProviderDescriptor, "configFields"> | null): AppliesAt {
  const declared = descriptor?.configFields.find(item => item.id === DESCRIPTOR_FIELD[fieldName])?.appliesAt;
  return declared ?? FIXED_APPLIES_AT[fieldName];
}

export type ProviderDefaults = Partial<{ [K in AgentConfigField]: unknown }>;
export type ResolvedField = { mode: "inherit" | "reset" | "explicit"; value: unknown; appliesAt: AppliesAt };
export type ResolvedAgentConfig = { provider: string; fields: Record<AgentConfigField, ResolvedField> };
/**
 * Inherit reads only `defaults` — the running computer's Provider defaults — never another configuration or an earlier
 * role (A2). Reset resolves to null: nothing is passed and the Provider's own default applies.
 */
export function resolveAgentConfig(payload: AgentConfigPayload, defaults: ProviderDefaults, descriptor: ProviderDescriptor | null): ResolvedAgentConfig {
  const fields = Object.fromEntries(AGENT_CONFIG_FIELDS.map(name => {
    const value = payload[name];
    const resolved = value.mode === "explicit" ? value.value : value.mode === "inherit" ? defaults[name] ?? null : null;
    return [name, { mode: value.mode, value: resolved, appliesAt: appliesAtFor(name, descriptor) }];
  })) as Record<AgentConfigField, ResolvedField>;
  return { provider: payload.provider, fields };
}

const STRENGTH: Record<AppliesAt | "none", number> = { none: 0, "next-turn": 1, "session-create": 2, "process-start": 3 };
/** What an edit needs before it is in effect: the strongest timing among changed fields; another Provider is a new process (A8). */
export function configChangeNeeds(before: ResolvedAgentConfig, after: ResolvedAgentConfig): AppliesAt | "none" {
  if (before.provider !== after.provider) return "process-start";
  let needed: AppliesAt | "none" = "none";
  for (const name of AGENT_CONFIG_FIELDS) {
    const a = before.fields[name], b = after.fields[name];
    if (canonicalJson(a.value ?? null) === canonicalJson(b.value ?? null) && a.mode === b.mode) continue;
    if (STRENGTH[b.appliesAt] > STRENGTH[needed]) needed = b.appliesAt;
  }
  return needed;
}

/** Requested and effective resource selections, without credentials or local paths (R-40). */
export type AgentConfigScope = { skills: typeof AGENT_CONFIG_SKILLS_SCOPE | { skillId: string }[]; tools: AgentConfigToolsScope; memory: { read: boolean; write: false } };
export type AgentConfigInventory = { skills: ReadonlyMap<string, string>; mcpServers: ReadonlyMap<string, string> };
export type FrozenAgentResources = { skills: { id: string; digest: string }[]; mcpServers: { id: string; digest: string }[] };
/**
 * `guarantees` is what the configuration asked for, kept so admission and the turn's fence enforce it or refuse (D-01).
 * `scope.requested` is the configuration's; `scope.effective` is what the run may use: Base read only under a read-only guarantee.
 * The role's own minimum (planning and review read-only) still applies at the turn.
 */
export type FrozenAgentConfig = { configId: string; revision: number; ciphertextHash: string; resolved: ResolvedAgentConfig; frozenAt: number;
  guarantees: AgentConfigPayload["guarantees"]; scope: { requested: AgentConfigScope; effective: AgentConfigScope }; resources: FrozenAgentResources };
/* The refusal reasons are named by the public workflow contract; this module decides them. */
export type { FreezeRefusal };
/** Only explicit resource scopes run; implicit defaults or unimplemented individual tool ids never widen access. */
function selectedScope(payload: AgentConfigPayload): AgentConfigScope | null {
  const { skills: requestedSkills, tools: requestedTools } = payload;
  if (requestedSkills.mode !== "explicit") return null;
  if (requestedTools.mode !== "explicit" || Array.isArray(requestedTools.value)) return null;
  return { skills: structuredClone(requestedSkills.value), tools: structuredClone(requestedTools.value),
    memory: { read: payload.memory.mode === "explicit" && payload.memory.value.read, write: false } };
}
/**
 * A run resolves the latest revision once and keeps the result (A5); runs already started keep theirs. Only an enabled
 * (`desktop`) record runs (A1); a tombstone is deleted, not absent (A9).
 */
export function freezeAgentConfig(input: { head: AgentConfigHead | null; payload: AgentConfigPayload | null;
  defaults: ProviderDefaults; descriptor: ProviderDescriptor | null; now: number; providerEnabled?: boolean;
  role?: "plan" | "develop" | "review"; inventory?: AgentConfigInventory }): { ok: true; frozen: FrozenAgentConfig } | { ok: false; reason: FreezeRefusal } {
  const { head, payload } = input;
  if (!head || head.tombstone || !payload || !head.ciphertextHash) return { ok: false, reason: "agent-config-deleted" };
  if (head.producerClass !== "desktop") return { ok: false, reason: "agent-config-not-enabled" };
  if (input.descriptor && input.descriptor.providerId !== payload.provider) return { ok: false, reason: "agent-config-provider-mismatch" };
  /* A Provider whose plugin is turned off runs nothing new; the configuration stays, it just cannot be chosen (Q29). */
  if (input.providerEnabled === false) return { ok: false, reason: "agent-config-provider-disabled" };
  /* Workflow roles can request explicit reads; no configuration can grant capture. */
  if (payload.memory.mode === "explicit" && payload.memory.value.write) return { ok: false, reason: "agent-config-memory-write-unsupported" };
  const requested = selectedScope(payload);
  if (!requested) return { ok: false, reason: "agent-config-scope-unsupported" };
  const readOnly = payload.guarantees.workspace === "read-only" || input.role === "plan" || input.role === "review";
  const selectedSkills = requested.skills === "none" ? [] : requested.skills;
  const selectedMcp = requested.tools.mcpServers ?? [];
  if (readOnly && selectedMcp.length) return { ok: false, reason: "agent-config-mcp-read-only" };
  if (selectedSkills.some(item => !input.inventory?.skills.has(item.skillId))) return { ok: false, reason: "agent-config-skill-unavailable" };
  if (selectedMcp.some(item => !input.inventory?.mcpServers.has(item.serverId))) return { ok: false, reason: "agent-config-mcp-unavailable" };
  const resources = { skills: selectedSkills.map(item => ({ id: item.skillId, digest: input.inventory!.skills.get(item.skillId)! })),
    mcpServers: selectedMcp.map(item => ({ id: item.serverId, digest: input.inventory!.mcpServers.get(item.serverId)! })) };
  const effective = { memory: { ...requested.memory }, skills: structuredClone(requested.skills), tools: { ...structuredClone(requested.tools), base: readOnly ? "read" as const : requested.tools.base } };
  return { ok: true, frozen: { configId: head.configId, revision: head.revision, ciphertextHash: head.ciphertextHash,
    resolved: resolveAgentConfig(payload, input.defaults, input.descriptor), frozenAt: input.now, guarantees: { ...payload.guarantees },
    scope: { requested, effective }, resources } };
}

/** Offered in a Project's pickers: every Project for `all`, else only listed Projects that still exist and are not archived (A6). */
export function offeredIn(payload: Pick<AgentConfigPayload, "availableIn">, projectId: string, liveProjectIds: ReadonlySet<string>) {
  return liveProjectIds.has(projectId) && (payload.availableIn === "all" || payload.availableIn.projects.includes(projectId));
}
