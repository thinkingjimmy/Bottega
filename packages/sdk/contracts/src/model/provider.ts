/**
 * [INPUT]: Depends on Zod and the zod-free capability leaf (provider-capabilities.ts)
 * [OUTPUT]: Provides the four-layer Provider contract: providerIdSchema, PROVIDER_CAPABILITIES/PROVIDER_PURPOSES/APPLIES_AT, homePathSchema, providerDescriptorSchema (with the optional CLI facts: instructions file, skills root, plugin mode, plan decisions; and the optional ACP launch arguments, bounded argv with no path separator) + providersDeclaring (layer 1), negotiateProviderGrammar (layer 2), measuredCapabilitySchema + currentMeasurements (layer 3), ROLE_REQUIREMENTS + admitRole + WORKFLOW_ROLES/admitWorkflowRole with typed refusals and host-enforced capabilities (layer 4), and configChangeEffect
 * [POS]: Public Provider contract shared by the host, Provider packages and later the SDK; support is proven by host measurement, never by a package's own declaration
 */
import { z } from "zod";

import { providerIdSchema } from "./provider/id-schema";
export { providerIdSchema } from "./provider/id-schema";
export type { ProviderId } from "./provider/id";

export { APPLIES_AT, PROVIDER_CAPABILITIES, PROVIDER_PURPOSES, providersDeclaring, type AppliesAt, type ProviderCapability, type ProviderPurpose }
  from "./provider-capabilities";
import { APPLIES_AT, PROVIDER_CAPABILITIES, PROVIDER_PURPOSES, type ProviderCapability } from "./provider-capabilities";

/* ── Layer 1: static descriptor (ceilings only; a package declares, it never proves) ───────────── */
const envName = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const commandArg = z.string().min(1).max(64).refine(value => !value.startsWith("@") && !/[\\/]/.test(value)
  && [...value].every(character => { const code = character.charCodeAt(0); return code >= 32 && (code < 127 || code > 159); }), "command-arg-invalid");
const pathSegment = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).refine(value => value !== "." && value !== "..", "path-segment");
/** A place the CLI reads, resolved by the host: the first of `env` that is set (trimmed, then joined with its segments), else
    `home` under the user's home. Segments are single names, so a declaration can never climb out of the root it names. */
export const homePathSchema = z.object({
  env: z.array(z.object({ name: envName, join: z.array(pathSegment).max(4) }).strict()).max(4),
  home: z.array(pathSegment).min(1).max(6),
}).strict();
export type HomePath = z.infer<typeof homePathSchema>;
export const providerDescriptorSchema = z.object({
  /** The descriptor format and its version. */
  schema: z.literal("bottega.provider-descriptor/v1"),
  /** The provider's id: lowercase letters, digits and hyphens, 2–32 characters. The product's identity for this provider. */
  providerId: providerIdSchema,
  /** The package that ships this provider; distinct from the provider id. */
  packageId: z.string().min(1).max(128).regex(/^[a-z][a-z0-9.-]*$/),
  /** The name people see, at most 64 characters. */
  displayName: z.string().min(1).max(64),
  /** The range of host handshake grammar versions the provider's bridge speaks. */
  grammar: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }).strict().refine(value => value.min <= value.max, "grammar-range"),
  /** How the host finds the CLI (commands, version arguments, minimum version), how it is launched, and which environment variables
      it may receive (names only; values come from the host's launch plan). */
  runtime: z.object({
    discovery: z.object({ commands: z.array(z.string().min(1).max(64)).min(1).max(8), versionArgs: z.array(z.string().min(1).max(32)).max(4),
      minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
    /* `args`: what starts the CLI speaking ACP on stdio (e.g. `["acp"]`), passed as argv after the discovered executable, never
       through a shell. An argument cannot contain a path separator, so it cannot name a path elsewhere; a bare name is relative to the
       working directory the host sets. No control characters (U+0000–U+001F, U+007F–U+009F) and no leading `@` (a response file some CLIs read). Absent
       and empty mean the same: no arguments (built-ins use the host's launch). */
    launch: z.object({ kind: z.enum(["acp-stdio-native", "acp-stdio-adapter"]), layer: z.enum(["native", "bundled-node"]),
      args: z.array(commandArg).max(8).optional() }).strict(),
    env: z.object({ allow: z.array(envName).max(64), processStart: z.array(envName).max(64) }).strict(),
  }).strict(),
  /** How the host learns whether the CLI is signed in, how a person signs in locally and remotely, and whether the check is safe
      to run without exposing credentials. */
  auth: z.object({
    check: z.enum(["status-command", "turn-evidence", "none"]),
    login: z.object({ local: z.enum(["terminal", "browser", "device-code"]), remote: z.enum(["device-code", "unsupported"]) }).strict(),
    credentialSafeProbe: z.boolean(),
    /** Shell-free argv on the discovered CLI. Exit zero must emit {status: "authenticated" | "unauthenticated" | "unknown"}. */
    statusCommand: z.object({ args: z.array(commandArg).min(1).max(8),
      format: z.literal("json-status-v1") }).strict().optional(),
    /** A local terminal action, displayed for confirmation and individually shell-quoted by the host. */
    loginArgs: z.array(commandArg).min(1).max(8).optional(),
  }).strict(),
  /** Where the CLI keeps state and credentials, requested for protection: the host validates each request and denies these roots
      to every other provider. */
  sensitiveRoots: z.object({ paths: z.array(z.string().min(1).max(256)).max(16), envOverrides: z.array(envName).max(16),
    keychainServices: z.array(z.string().min(1).max(128)).max(8), retainAfterUninstall: z.boolean() }).strict(),
  /** The configuration fields the provider accepts and when each takes effect: next turn, session creation or process start. */
  configFields: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), appliesAt: z.enum(APPLIES_AT), required: z.boolean() }).strict()).max(64)
    .refine(value => new Set(value.map(item => item.id)).size === value.length, "config-field-duplicate"),
  /** Every capability, stated as declared or unsupported. A declaration is a ceiling only: support is proven by host measurement. */
  capabilities: z.record(z.enum(PROVIDER_CAPABILITIES), z.enum(["declared", "unsupported"])),
  /** Every purpose the host may use the provider for, as native, host-fallback or unsupported. */
  purposes: z.record(z.enum(PROVIDER_PURPOSES), z.enum(["native", "host-fallback", "unsupported"])),
  /** Optional one-shot ACP title work; no other background purpose is admitted for packages. */
  headless: z.array(z.literal("title")).max(1).optional(),
  /** Mapped onto the closed host failure set; an unknown class is shown as the generic failure. */
  failureClasses: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)).max(32),
  /* Facts about the CLI a host needs to run it correctly. Absent means the CLI has none of it: no user instructions file, no
     skills root, no plugins, and plan decisions it reports itself. */
  /** The user-level instructions file the CLI reads, and the directory it reads it from. */
  instructions: z.object({ file: z.string().regex(/^[A-Za-z0-9._-]{1,60}\.md$/), directory: homePathSchema }).strict().optional(),
  /** The CLI's own skills root; `readsSharedRoot`: it also reads the cross-agent `~/.agents/skills`. */
  skills: z.object({ root: homePathSchema, readsSharedRoot: z.boolean() }).strict().optional(),
  /** How the host may treat the CLI's own plugins: manage them, only list them, or refuse them. */
  plugins: z.object({ mode: z.enum(["managed", "read-only", "blocked"]) }).strict().optional(),
  /** `synthesized`: the CLI never reports a plan decision, so the host derives it from the plan it sent. */
  planDecision: z.enum(["native", "synthesized"]).optional(),
}).strict();

export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;

/* ── Layer 2: handshake grammar ─────────────────────────────────────────────────────────────────── */
export const HOST_PROVIDER_GRAMMAR = Object.freeze({ min: 1, max: 1 });
export const providerHelloSchema = z.object({ providerId: providerIdSchema, grammar: z.number().int().min(1),
  requiredFields: z.array(z.string().min(1).max(64)).max(64) }).strict();
/** The fields a bridge may mark required at grammar 1; anything else required is unknown to this host. */
const KNOWN_REQUIRED_FIELDS = new Set(["executionRef", "workspaceRef", "toolPlanRef", "resultSinkRef"]);

export function negotiateProviderGrammar(descriptor: ProviderDescriptor, hello: z.input<typeof providerHelloSchema>) {
  const parsed = providerHelloSchema.parse(hello);
  if (parsed.providerId !== descriptor.providerId) return { ok: false as const, reason: "provider-mismatch" };
  const grammar = Math.min(descriptor.grammar.max, HOST_PROVIDER_GRAMMAR.max, parsed.grammar);
  if (grammar < Math.max(descriptor.grammar.min, HOST_PROVIDER_GRAMMAR.min) || parsed.grammar !== grammar) {
    return { ok: false as const, reason: "grammar-unsupported" };
  }
  const unknown = parsed.requiredFields.filter(field => !KNOWN_REQUIRED_FIELDS.has(field));
  if (unknown.length) return { ok: false as const, reason: "required-field-unknown", unknown };
  return { ok: true as const, grammar };
}

/* ── Layer 3: measured capabilities (host probes; bound to the exact CLI, package and probe) ─────── */
export const measurementIdentitySchema = z.object({ cliIdentity: z.string().min(1).max(512), cliVersion: z.string().min(1).max(64),
  packageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), probeVersion: z.string().min(1).max(64) }).strict();
export type MeasurementIdentity = z.infer<typeof measurementIdentitySchema>;
export const measuredCapabilitySchema = z.object({ providerId: providerIdSchema, capability: z.enum(PROVIDER_CAPABILITIES),
  state: z.enum(["enforced", "unverified", "unsupported"]), identity: measurementIdentitySchema, probeId: z.string().min(1).max(128),
  measuredAt: z.number().int().min(0) }).strict();
export type MeasuredCapability = z.infer<typeof measuredCapabilitySchema>;

/** Measurements whose CLI, package or probe identity no longer matches are dropped, never trusted as stale evidence. */
export function currentMeasurements(records: readonly MeasuredCapability[], current: MeasurementIdentity) {
  return records.filter(record => record.identity.cliIdentity === current.cliIdentity && record.identity.cliVersion === current.cliVersion &&
    record.identity.packageDigest === current.packageDigest && record.identity.probeVersion === current.probeVersion);
}

/* ── Layer 4: role admission ───────────────────────────────────────────────────────────── */
export const ROLE_REQUIREMENTS = Object.freeze({
  /* Planning and review need a workspace the Provider cannot write; the absence of side-effecting business tools is
     Bottega's own tool set, not a Provider capability. Only result-format runs with no tools at all. */
  "plan-review": ["read-only"],
  implement: ["cancel"],
  "result-format": ["tool-filter", "read-only"],
} as const satisfies Record<string, readonly ProviderCapability[]>);
export type ProviderRole = keyof typeof ROLE_REQUIREMENTS;

/**
 * Admitted only when every required capability is either enforced by the host itself (`hostEnforced`) or measured
 * `enforced` for the current identity and not declared unsupported by the package. `unverified` never counts. An explicit user request (e.g. no network) becomes a
 * hard requirement of the role for this binding.
 */
export function admitRole(input: { role: ProviderRole; descriptor: ProviderDescriptor; measured: readonly MeasuredCapability[];
  identity: MeasurementIdentity; userRequires?: readonly ProviderCapability[];
  /** What the host itself enforces for this Provider on this computer (e.g. a read-only sandbox around it): met without the CLI. */
  hostEnforced?: readonly ProviderCapability[] }) {
  const required = [...new Set<ProviderCapability>([...ROLE_REQUIREMENTS[input.role], ...(input.userRequires ?? [])])];
  const current = currentMeasurements(input.measured.filter(item => item.providerId === input.descriptor.providerId), input.identity);
  const missing = required.filter(capability => !input.hostEnforced?.includes(capability) && (input.descriptor.capabilities[capability] === "unsupported" ||
    !current.some(item => item.capability === capability && item.state === "enforced")));
  return missing.length ? { admitted: false as const, missing } : { admitted: true as const };
}

/* Workflow steps map onto the provider roles: planning and review may not write the workspace, development implements. */
export const WORKFLOW_ROLES = Object.freeze({ plan: "plan-review", review: "plan-review", develop: "implement" } as const);
export type WorkflowRole = keyof typeof WORKFLOW_ROLES;
/**
 * A step's picker shows every configuration and greys the ones that cannot take the step, with a typed reason:
 * `provider-cannot` when the descriptor rules a required capability out (Copilot cannot keep a workspace read-only, so
 * plan and review are refused for it), `not-measured` when the capability is possible but not proven enforced on
 * this exact CLI, package and probe.
 * Measured (CLI canary, 2026-09-25): Claude 2.1.282 proves read-only and tool-filter through a tool allowlist (plan
 * mode makes the model decline rather than be refused); Codex 0.155.1 proves read-only through its sandbox and cancel,
 * so it can plan, review and develop, but not tool-filter, so result-format stays `not-measured` for it.
 */
export function admitWorkflowRole(input: { role: WorkflowRole; descriptor: ProviderDescriptor; measured: readonly MeasuredCapability[];
  identity: MeasurementIdentity; userRequires?: readonly ProviderCapability[]; hostEnforced?: readonly ProviderCapability[] }) {
  const result = admitRole({ ...input, role: WORKFLOW_ROLES[input.role] });
  if (result.admitted) return result;
  const impossible = result.missing.filter(capability => input.descriptor.capabilities[capability] === "unsupported");
  return { admitted: false as const, reason: impossible.length ? "provider-cannot" as const : "not-measured" as const, missing: result.missing };
}

/** What a changed config value requires; `process-start` changes the process identity, so a pool must not reuse it. */
export function configChangeEffect(descriptor: ProviderDescriptor, fieldId: string): "next-turn" | "new-session" | "new-process" | "unknown-field" {
  const field = descriptor.configFields.find(item => item.id === fieldId);
  if (!field) return "unknown-field";
  return field.appliesAt === "next-turn" ? "next-turn" : field.appliesAt === "session-create" ? "new-session" : "new-process";
}
