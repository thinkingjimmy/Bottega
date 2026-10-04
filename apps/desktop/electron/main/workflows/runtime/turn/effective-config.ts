/**
 * [INPUT]: Depends on Frozen config contracts, Provider readiness/measurement admission, builtin tool version gates and Chat defaults.
 * [OUTPUT]: Provides admitFrozen, preflightRoles, turnOptionsFor, turnReadOnly, turnNetworkOff, unappliedSettings and appliedScopeDifferences.
 * [POS]: Workflow role admission and effective setting translation; mandatory read-only caps remain visible without disabling valid configs.
 * Missing measurement identity is distinct from missing installation.
 * Frozen scope preserves explicit Memory readonly intent for main-owned turn policy.
 */
import type { FreezeRefusal, FrozenAgentConfig } from "@ai-chat/cloud-protocol/agent-config/payload";
import { admitWorkflowRole, type MeasuredCapability, type MeasurementIdentity, type ProviderCapability } from "@ai-chat/cloud-protocol/contracts/provider";
import type { ConfigApplySetting, WorkflowRolePreflight } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import { builtinToolsForVersion } from "../../../backends/runtime/runtime-probe";
import type { BlockedReason, PROVIDER_AUTH_UNCERTAIN, REQUESTED_GUARANTEES } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import type { AgentBackendId, AgentTurnOptions } from "../../../../../shared/ipc/agent/agent-ipc";
import { DEFAULT_CHAT_OPTIONS_BY_BACKEND } from "../../../../../shared/chat-agent/options";
import { builtinProviderDescriptor } from "../../../../../shared/providers/builtin";

type Guarantees = FrozenAgentConfig["guarantees"];
type Fields = Record<string, { mode?: string; value?: unknown }>;
type Guarantee = (typeof REQUESTED_GUARANTEES)[number];
/** A frozen configuration as the run ledger keeps it (JSON); older runs may carry no guarantees, which asks for nothing. */
export type FrozenLike = { resolved?: { provider?: string; fields?: Fields }; guarantees?: Guarantees;
  scope?: { requested?: { tools?: { base?: "read" | "read-write" }; memory?: { read: boolean; write: boolean } }; effective?: { tools?: { base?: "read" | "read-write" }; memory?: { read: boolean; write: boolean } } };
  resources?: FrozenAgentConfig["resources"] };
export type Admission = { admitted: true } | { admitted: false; reason: BlockedReason["kind"]; guarantee?: Guarantee;
  /** T21-c: the configuration's own settings that would not take effect here; the role is refused rather than run on a default. */
  settings?: readonly ConfigApplySetting[] };

/** A role's mandatory read-only cap is visible without making an otherwise valid configuration unusable. */
export function appliedScopeDifferences(frozen: FrozenLike): ConfigApplySetting[] {
  return frozen.scope?.requested?.tools?.base !== frozen.scope?.effective?.tools?.base ? ["tools"] : [];
}

/**
 * T21-c: which of a configuration's explicit choices this computer cannot apply — a permission mode the Provider does not take,
 * or a model its directory does not list (no directory, nothing to check). Inherited and reset values were not chosen for the
 * configuration, so they are never its partial apply.
 */
export function unappliedSettings(fields: Fields, facts: { permissionModes: readonly string[]; models: readonly string[] | null }): ConfigApplySetting[] {
  const unapplied: ConfigApplySetting[] = [];
  const permission = fields.permissionMode, model = fields.model;
  if (permission?.mode === "explicit" && typeof permission.value === "string" && !facts.permissionModes.includes(permission.value)) unapplied.push("permissions");
  if (model?.mode === "explicit" && typeof model.value === "string" && facts.models && !facts.models.includes(model.value)) unapplied.push("model");
  return unapplied.sort();
}

/** Planning and review may not write the workspace (04 §5); development may. */
const READ_ONLY_ROLES: ReadonlySet<WorkflowRoleName> = new Set(["plan", "review"]);
const TURN_FIELDS = ["model", "reasoningEffort", "permissionMode"] as const;

/**
 * D-02 / F04: the turn's options are the frozen fields, applied in full; this computer's Chat defaults fill only a field the frozen
 * configuration does not carry (an older run). An explicit or inherited value (inherit was resolved from this computer's defaults at
 * freeze) is used as is; an inherit with no value clears the option, so the Provider's own default applies, never a default picked
 * after the freeze; a reset field is the Provider's factory default — never the saved default it resets — and absent when the
 * factory has none. The permission mode is required: with no frozen value it is the factory's, never a mutable default.
 */
export function turnOptionsFor(backend: AgentBackendId, fields: Fields, chatDefaults: AgentTurnOptions): AgentTurnOptions {
  const options: Record<string, unknown> = { ...chatDefaults, backend };
  const factory = DEFAULT_CHAT_OPTIONS_BY_BACKEND[backend] as Record<string, unknown>;
  for (const name of TURN_FIELDS) {
    const field = fields[name];
    if (!field) continue;
    if (typeof field.value === "string" && field.mode !== "reset") options[name] = field.value;
    else if (field.mode === "reset" || name === "permissionMode") {
      if (factory[name] === undefined) delete options[name];
      else options[name] = factory[name];
    } else delete options[name];
  }
  return options as AgentTurnOptions;
}

/** D-01: the turn is read-only when its role requires it or its configuration asked for a read-only workspace. */
export function turnReadOnly(role: WorkflowRoleName, guarantees: Guarantees | undefined) {
  return READ_ONLY_ROLES.has(role) || guarantees?.workspace === "read-only";
}

/** TASK-12: the turn runs with no network for its tools exactly when its configuration asked. */
export function turnNetworkOff(guarantees: Guarantees | undefined) {
  return guarantees?.network === "off";
}

/**
 * D-01: what the configuration asked for that this step cannot have. Only a Provider that declares network-off can keep its tools
 * offline while its model stays online (Claude: its sandbox proxy's domain allowlist); every other one is refused by name here, and
 * Claude is still admitted only on its own measurement (userRequires below). A read-only workspace cannot develop.
 */
function guaranteeRefusal(role: WorkflowRoleName, guarantees: Guarantees | undefined, provider: string): Guarantee | null {
  if (turnNetworkOff(guarantees) && builtinProviderDescriptor(provider)?.capabilities["network-off"] !== "declared") return "network-off";
  return guarantees?.workspace === "read-only" && !READ_ONLY_ROLES.has(role) ? "workspace-read-only" : null;
}

/**
 * Admission for one role (04 §5): the requested guarantees first (a property of the configuration), then the Provider's plugin,
 * installation and sign-in on this computer, then measured role admission with the requested guarantees as user requirements.
 */
/** What a Provider is on this computer now (E2-04: ready only on positive sign-in evidence, after a bounded refresh). */
export type ProviderReadiness = "ready" | "plugin-disabled" | "provider-not-installed" | "provider-version-too-old" | "provider-signed-out" | (typeof PROVIDER_AUTH_UNCERTAIN)[number];

export async function admitFrozen(role: WorkflowRoleName, frozen: FrozenLike, ports: {
  readiness(providerId: string): Promise<ProviderReadiness>;
  measurements(providerId: string): Promise<{ measured: MeasuredCapability[]; identity: MeasurementIdentity | null }>;
  /** What this computer's host enforces around the Provider itself (RSH-07: the read-only sandbox); absent means nothing. */
  hostEnforced?(providerId: string): readonly ProviderCapability[];
  /** T21-c: the configuration's explicit settings this computer cannot apply (unappliedSettings over its runtime); absent means none. */
  unapplied?(providerId: string, fields: Fields, workspace: string | null): Promise<readonly ConfigApplySetting[]>;
}, where: { workspace?: string | null } = {}): Promise<Admission> {
  const provider = frozen.resolved?.provider ?? "";
  const guarantee = guaranteeRefusal(role, frozen.guarantees, provider);
  if (guarantee) return { admitted: false, reason: "guarantee-unavailable", guarantee };
  const descriptor = builtinProviderDescriptor(provider);
  if (!descriptor) return { admitted: false, reason: "config-unavailable" };
  const readiness = await ports.readiness(provider);
  if (readiness !== "ready") return { admitted: false, reason: readiness };
  const { measured, identity } = await ports.measurements(provider);
  if (!identity) return { admitted: false, reason: "provider-measurements-unavailable" };
  if (provider === "kimi" && builtinToolsForVersion("kimi", identity.cliVersion) === "none") {
    return { admitted: false, reason: "provider-version-too-old" };
  }
  const userRequires: ProviderCapability[] = [...(frozen.guarantees?.workspace === "read-only" ? ["read-only" as const] : []),
    ...(turnNetworkOff(frozen.guarantees) ? ["network-off" as const] : [])];
  const result = admitWorkflowRole({ role, descriptor, measured, identity, userRequires, hostEnforced: ports.hostEnforced?.(provider) ?? [] });
  if (!result.admitted) return { admitted: false, reason: result.reason };
  /* No silent substitute: a setting that would not take effect refuses the role instead of running it on the default. */
  /* The step's own workspace: a Provider's model directory may come from the Project's config (OpenCode's opencode.json). */
  const settings = await ports.unapplied?.(provider, frozen.resolved?.fields ?? {}, where.workspace ?? null) ?? [];
  return settings.length ? { admitted: false, reason: "config-unavailable", settings: [...settings] } : { admitted: true };
}

/** E-03: each role's configuration as a run would take it — frozen at its latest revision, then admitted — before turning a workflow on. */
export async function preflightRoles(roles: Readonly<Partial<Record<WorkflowRoleName, string>>>, ports: {
  freeze(configId: string, role?: WorkflowRoleName): { ok: true; frozen: unknown } | { ok: false; reason: string };
  admit(role: WorkflowRoleName, frozen: unknown): Promise<Admission>;
  /** T21-c: records on the configuration whether the frozen version's settings apply here (null: all of them), for its row and the
      role's refusal; the frozen version names what was judged (R03). */
  report?(frozen: unknown, settings: readonly ConfigApplySetting[] | null): void;
}): Promise<Partial<Record<WorkflowRoleName, WorkflowRolePreflight>>> {
  const answers = await Promise.all(Object.entries(roles).map(async ([role, configId]) => {
    const frozen = ports.freeze(configId!, role as WorkflowRoleName);
    if (!frozen.ok) return [role, { ready: false, refusal: frozen.reason as FreezeRefusal, provider: null, guarantee: null }] as const;
    const admitted = await ports.admit(role as WorkflowRoleName, frozen.frozen);
    const provider = (frozen.frozen as FrozenLike).resolved?.provider ?? null;
    const partial = !admitted.admitted && admitted.settings?.length ? admitted.settings : null;
    ports.report?.(frozen.frozen, [...new Set([...(partial ?? []), ...appliedScopeDifferences(frozen.frozen as FrozenLike)])]);
    if (partial) return [role, { ready: false, refusal: "agent-config-partially-applied" as const, provider, guarantee: null, settings: partial }] as const;
    return [role, admitted.admitted ? { ready: true } : { ready: false, refusal: admitted.reason as Extract<WorkflowRolePreflight, { ready: false }>["refusal"],
      provider: admitted.reason === "config-unavailable" ? null : provider, guarantee: admitted.guarantee ?? null }] as const;
  }));
  return Object.fromEntries(answers) as Partial<Record<WorkflowRoleName, WorkflowRolePreflight>>;
}
