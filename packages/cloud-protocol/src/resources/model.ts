/**
 * [INPUT]: Depends on Zod, the encryption scalars and purpose limits, the encrypted-space schema, REMOTE_LIMITS, the workflow confirm input and bridge refusal codes.
 * [OUTPUT]: Provides RESOURCE_LIMITS, the closed resource kinds and classes, the action registry (resourceActionDescriptor: class and criticality per action), the sealed command body and result body, the refusal codes, the encrypted command (plaintext header + packet), the encrypted result and the receipt. Registers App impact/enablement, requester-bound plugin installation and bounded encrypted record/result pages.
 * [POS]: Resource-command domain model (protocol 13, purposes 10 / 11, §10.1): a phone or Web asks the computer that owns a resource to act on it. The header names no action, input or path; the owner re-derives the class and criticality from the action and refuses a mismatch.
 */
import { appDisableImpactSchema, setAppEnabledInputSchema } from "../apps/build-status/enablement";
import { z } from "zod";
import { digest, id, version } from "../encryption/domains/scalars";
import { PLAINTEXT_LIMITS } from "../encryption/limits";
import { encryptedSpaceSchema } from "../spaces";
import { REMOTE_LIMITS } from "../remote/model";
import { confirmInputSchema } from "../contracts/workflow/run";
import { WORKFLOW_BRIDGE_ERRORS } from "../contracts/workflow/bridge";
import { previewViewSchema } from "./preview";
import { pluginInstallSourceSchema, pluginInstallReceiptSchema } from "./plugin-install";
import { pluginRecordReadSchema, pluginRecordReportSchema, pluginRecordResultsSchema, pluginRecordPageSchema } from "./plugin-records";

const packet = (plaintextBytes: number) => { const envelopeBytes = Math.ceil(plaintextBytes * 4 / 3) + 8_192; return { envelopeBytes, packetChars: Math.ceil(envelopeBytes * 4 / 3) }; };
const command = packet(PLAINTEXT_LIMITS[10]), result = packet(PLAINTEXT_LIMITS[11]);
export const RESOURCE_LIMITS = Object.freeze({
  commandEnvelopeBytes: command.envelopeBytes, commandPacketChars: command.packetChars, resultEnvelopeBytes: result.envelopeBytes, resultPacketChars: result.packetChars,
  /** Longest life of a command from its creation, by class (§10.1). */
  ttlMs: Object.freeze({ read: 120_000, control: 120_000, work: 600_000 }),
  /** Per target: work has its own lane; read and non-critical control share the control lane without its reserved slots. */
  unfinishedWorkPerTarget: REMOTE_LIMITS.unfinishedWorkPerTarget, unfinishedControlPerTarget: REMOTE_LIMITS.unfinishedControlsPerTarget,
  criticalReserved: REMOTE_LIMITS.controlReservedPerTarget, inboxItems: 20, receiptsPerRead: 20,
  /** An accepted command whose owner never says how it ended is called unknown this long after it expired. */
  acceptedGraceMs: 3_600_000,
});
export const RESOURCE_CONTRACT = "bottega.resource/v1";
export const RESOURCE_KINDS = ["provider-quota", "workflow-run", "workflow-binding", "app", "preview", "plugin"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const RESOURCE_CLASSES = ["read", "control", "work"] as const;
export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

const empty = z.object({}).strict();
/** The action registry (§10.1): each action belongs to one kind, with its class, criticality and exact input. Names are unique across kinds. */
const REGISTRY = {
  "plugin-record-read": { kind: "plugin", class: "read", critical: false, input: pluginRecordReadSchema },
  "plugin-record-report": { kind: "plugin", class: "work", critical: false, input: pluginRecordReportSchema },
  "plugin-record-results": { kind: "plugin", class: "read", critical: false, input: pluginRecordResultsSchema },
  "plugin-install-request": { kind: "plugin", class: "work", critical: false, input: pluginInstallSourceSchema },
  "plugin-install-status": { kind: "plugin", class: "read", critical: false, input: empty },
  "preview-status": { kind: "preview", class: "read", critical: false, input: z.object({ chatId: id, incarnationId: id }).strict() },
  "preview-start": { kind: "preview", class: "work", critical: false, input: z.object({ chatId: id, incarnationId: id }).strict() },
  "preview-stop": { kind: "preview", class: "control", critical: true, input: z.object({ chatId: id, incarnationId: id }).strict() },
  "preview-issue-code": { kind: "preview", class: "control", critical: false, input: z.object({ chatId: id, incarnationId: id }).strict() },
  refresh: { kind: "provider-quota", class: "read", critical: false, input: empty },
  confirm: { kind: "workflow-run", class: "control", critical: true, input: confirmInputSchema },
  cancel: { kind: "workflow-run", class: "control", critical: true, input: empty },
  "force-stop": { kind: "workflow-run", class: "control", critical: true, input: empty },
  pause: { kind: "workflow-run", class: "control", critical: false, input: empty },
  resume: { kind: "workflow-run", class: "control", critical: false, input: empty },
  "check-result": { kind: "workflow-run", class: "control", critical: false, input: empty },
  "retry-step": { kind: "workflow-run", class: "control", critical: false, input: z.object({ stepId: id }).strict() },
  "enable-blocking-plugin": { kind: "workflow-run", class: "control", critical: false, input: z.object({ stepId: id, expectedRevision: version }).strict() },
  "read-evidence": { kind: "workflow-run", class: "read", critical: false, input: z.object({ stepId: id, kind: z.enum(["diff", "report"]),
    offset: version.max(65_536) }).strict() },
  "start-rework": { kind: "workflow-run", class: "work", critical: false, input: z.object({ choice: z.enum(["keep-plan", "replan"]) }).strict() },
  start: { kind: "workflow-binding", class: "work", critical: false, input: z.object({ rowId: id }).strict() },
  /* U06: the App's Use Chat (the current one, or a new one) and latest Edit Chat, opened on the owner without taking its window's
     focus; a rebuild is the owner's own after-edit build. Repair runs repository code and stays on the computer (Q-U4). */
  "open-use-chat": { kind: "app", class: "control", critical: false, input: z.object({ mode: z.enum(["current", "new"]) }).strict() },
  "open-editor": { kind: "app", class: "control", critical: false, input: empty },
  "disable-impact": { kind: "app", class: "read", critical: false, input: empty },
  "set-enabled": { kind: "app", class: "control", critical: true, input: setAppEnabledInputSchema },
  rebuild: { kind: "app", class: "work", critical: false, input: empty },
  /* U06-d (Q-U8): a remote device can only decline an extension the owner waits on, never approve it; first writer wins. */
  "decline-extension": { kind: "app", class: "control", critical: true, input: z.object({ requestId: id }).strict() },
} as const satisfies Record<string, { kind: ResourceKind; class: ResourceClass; critical: boolean; input: z.ZodType }>;
export type ResourceAction = keyof typeof REGISTRY;
export type ResourceActionInput<A extends ResourceAction> = z.input<(typeof REGISTRY)[A]["input"]>;
export const RESOURCE_ACTIONS = Object.keys(REGISTRY) as ResourceAction[];
/** The class and criticality the owner holds a command to; null for an action the kind does not have. */
export function resourceActionDescriptor(kind: string, action: string): { class: ResourceClass; critical: boolean } | null {
  const entry = (REGISTRY as Record<string, (typeof REGISTRY)[ResourceAction]>)[action];
  return entry && entry.kind === kind ? { class: entry.class, critical: entry.critical } : null;
}
export const resourceActionKind = (action: ResourceAction): ResourceKind => REGISTRY[action].kind;
export const resourceCommandBodySchema = z.union(RESOURCE_ACTIONS.map(action => z.object({ contract: z.literal(RESOURCE_CONTRACT), action: z.literal(action),
  input: REGISTRY[action].input }).strict()) as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]);
export type ResourceCommandBody = { contract: typeof RESOURCE_CONTRACT; action: ResourceAction; input: unknown };

/** Closed refusal codes: the workflow bridge's, plus the command's own. `failed` stands for anything unexpected, never its message. */
/** `command-expired` (C2-03): accepted in time, but its deadline passed on the owner before the effect, so it never ran.
    `unsupported-action`: a registered action this owner does not run yet (rebuild before U06-d). `app-transitioning`: the App is being
    installed, updated or removed, a pause that passes; `app-not-editable` is one that does not (U06-c). `startup-recovery-pending` /
    `earlier-process-holding`: the computer's startup recovery or an earlier Agent process held the command past its bounded wait. `already-resolved` (from the bridge list): for decline-extension, the extension decision it names was
    already made (on the computer, or by an earlier decline or the time limit); nothing changed (U06-d). */
export const RESOURCE_REFUSALS = [...WORKFLOW_BRIDGE_ERRORS, "class-mismatch", "invalid-command", "provider-unknown", "not-waiting", "input-changed", "command-expired",
  "app-disabled", "app-enablement-stale", "app-not-found", "app-not-editable", "app-busy", "app-transitioning", "unsupported-action", "startup-recovery-pending", "earlier-process-holding",
  "plugin-setup-required", "plugin-unsupported", "plugin-not-found", "plugin-not-switchable", "tunnel-platform-unsupported", "tunnel-plugin-disabled",
  "tunnel-download-consent-required", "preview-service-unavailable", "preview-service-changed", "preview-chat-changed", "preview-session-closed",
  "preview-tunnel-unavailable", "preview-session-limit", "preview-account-required", "plugin-request-unavailable", "plugin-request-limit",
  "plugin-record-unavailable", "plugin-record-changed", "plugin-record-budget", "failed"] as const;
export type ResourceRefusal = (typeof RESOURCE_REFUSALS)[number];
/** `runId` for an action that creates a run (start, start-rework); `revision` is the run projection's revision after the action; `chatId` for the Chat an App action opened (none from open-editor while the App has no Edit Chat yet: the sender starts one). */
export const resourceResultBodySchema = z.union([
  z.object({ ok: z.literal(true), runId: id.optional(), revision: version.positive().optional(), chatId: id.optional(),
    appImpact: appDisableImpactSchema.optional(),
    pluginInstall: pluginInstallReceiptSchema.optional(),
    pluginRecord: pluginRecordPageSchema.optional(),
    preview: previewViewSchema.optional(),
    evidence: z.object({ kind: z.enum(["diff", "report"]), offset: version.max(65_536), nextOffset: version.max(65_536).nullable(),
      totalBytes: version.max(2 * 1024 * 1024), chunk: z.string().max(5462).regex(/^[A-Za-z0-9_-]*$/), digest, truncated: z.boolean() }).strict().optional() }).strict(),
  z.object({ ok: z.literal(false), code: z.enum(RESOURCE_REFUSALS) }).strict(),
]);
export type ResourceResultBody = z.infer<typeof resourceResultBodySchema>;

const packetSchema = (limits: { envelopeBytes: number; packetChars: number }) => z.object({ envelope: z.string().min(1).max(limits.packetChars).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: digest, ciphertextBytes: version.positive().max(limits.envelopeBytes) }).strict();
/** The plaintext header (§10.1): routing, class and time only. `commandId` is also the idempotency id. */
export const resourceCommandHeaderSchema = z.object({ commandId: id, sourceDeviceId: id, targetDeviceId: id, protocolVersion: version.positive(),
  resourceKind: z.enum(RESOURCE_KINDS), resourceId: id, class: z.enum(RESOURCE_CLASSES), critical: z.boolean(), createdAt: version, expiresAt: version }).strict();
export type ResourceCommandHeader = z.infer<typeof resourceCommandHeaderSchema>;
export const encryptedResourceCommandSchema = resourceCommandHeaderSchema.extend({ encryptedSpace: encryptedSpaceSchema, packet: packetSchema(command) }).strict();
export type EncryptedResourceCommand = z.infer<typeof encryptedResourceCommandSchema>;
/** accepted (revision 1, no body) → succeeded | refused (with a body) | unknown (the owner cannot say, no body). */
export const encryptedResourceResultSchema = z.object({ revision: version.positive().max(2), state: z.enum(["accepted", "succeeded", "refused", "unknown"]),
  packet: packetSchema(result).nullable() }).strict().refine(value => (value.state === "succeeded" || value.state === "refused") === (value.packet !== null), "result-body");
export type EncryptedResourceResult = z.infer<typeof encryptedResourceResultSchema>;
/* `revoked`: the server refused a pending command's first acceptance because its sender's device or the session it was issued under is
   no longer current (review 0929 F02); it never ran. */
export const RESOURCE_STATES = ["pending", "accepted", "succeeded", "refused", "expired", "unknown", "revoked"] as const;
export const resourceReceiptSchema = z.object({ command: resourceCommandHeaderSchema.extend({ encryptedSpace: encryptedSpaceSchema, ciphertextHash: digest }).strict(),
  state: z.enum(RESOURCE_STATES), result: encryptedResourceResultSchema.nullable(), updatedAt: version }).strict();
export type ResourceReceipt = z.infer<typeof resourceReceiptSchema>;
