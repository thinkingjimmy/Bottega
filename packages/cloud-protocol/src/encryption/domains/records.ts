/**
 * [INPUT]: Closed identity, revision and ciphertext-reference scalars.
 * [OUTPUT]: Provides Chat, Project, App, Skill, account-configuration, Agent-configuration, workflow projection (run, attention, binding), App build status and resource-command / result bindings (including the project kind) with named allowed-metadata commitments.
 * [POS]: Record-level domain separation; no title, option value, source path or plaintext digest is metadata.
 */
import { z } from "zod";
import { agent, commitment, digest, id, nullableId, referencesSchema, version } from "./scalars";
const classificationMetadataSchema = z.object({ kind: z.enum(["ordinary", "app-use", "app-edit"]), projectId: nullableId, appId: nullableId }).strict()
  .refine(value => (value.kind === "ordinary") === (value.appId === null) && (value.kind !== "app-edit" || value.projectId !== null));
export const chatMetadataSchema = z.object({ incarnationId: id, classification: classificationMetadataSchema, sourceDeviceId: id,
  agent, agentRevision: version, expectedRevision: version, archivedAt: version.nullable(), references: referencesSchema }).strict();
export const projectMetadataSchema = z.object({ role: z.enum(["workspace", "base-custody"]), appId: nullableId, sourceDeviceId: id,
  expectedRevision: version, archivedAt: version.nullable(), order: version, references: referencesSchema }).strict().refine(value => value.role !== "base-custody" || value.appId === null);
export const chatBindingSchema = z.object({ role: z.enum(["title", "facts", "metadata", "options", "classification", "initial"]),
  incarnationId: id, expectedRevision: version, metadataCommitment: digest }).strict();
export const projectBindingSchema = z.object({ role: z.enum(["facts", "operation", "result"]), expectedRevision: version, metadataCommitment: digest }).strict();
export const appBindingSchema = z.object({ role: z.enum(["facts", "operation", "package", "result"]), projectId: id, baseId: id,
  expectedRevision: version, packageRevision: version, metadataCommitment: digest }).strict();
export const hashChatMetadata = (value: z.input<typeof chatMetadataSchema>) => commitment("chat", chatMetadataSchema, value);
export const hashProjectMetadata = (value: z.input<typeof projectMetadataSchema>) => commitment("project", projectMetadataSchema, value);

export const skillHeadBindingSchema = z.object({ expectedRevision: version, slugKey: digest,
  activeGenerationDigest: digest.nullable(), tombstone: z.boolean() }).strict();
/* A generation manifest blob (a Skill's or, R-26, an App surface's) is bound to its owner and generation; one shape serves both. */
const generationBinding = <K extends "libraryId" | "appId" | "pluginOwnerId">(owner: K) => z.object({ ...({ [owner]: id } as { [P in K]: typeof id }), generationId: id, blobId: id,
  manifestId: id, chunkIndex: version, chunkCount: version.positive() }).strict()
  .refine(value => (value as { chunkIndex: number }).chunkIndex < (value as { chunkCount: number }).chunkCount);
export const skillGenerationBindingSchema = generationBinding("libraryId");
export const appSurfaceGenerationBindingSchema = generationBinding("appId");
export const pluginSurfaceGenerationBindingSchema = generationBinding("pluginOwnerId");
/* The only account-configuration kind is the Dock layout; a generic key/value namespace is deliberately absent. */
export const accountConfigBindingSchema = z.object({ configKind: z.literal("dock-layout"), configSchemaVersion: version.positive().max(65_535),
  expectedRevision: version }).strict();
/* Agent configuration (purpose 9): the producer class is authenticated so a draft from a phone cannot be relabelled as a
   desktop write; no Project appears here — where a config is offered lives only in the encrypted payload. */
export const agentConfigurationBindingSchema = z.object({ configSchemaVersion: version.positive().max(65_535), expectedRevision: version,
  producerClass: z.enum(["desktop", "draft"]) }).strict();
/* Workflow projections (P13 §10.2, purpose 12 / 13; 13 is a workflow binding projection or an App's build status). Written only by the owner desktop; ids are random and name no content.
   A run record is bound to its run, owner and Project; the attention row to its computer and the badge count it shows; a
   binding projection to its Project, owner, schema version and state class (§3.1). */
export const workflowRunBindingSchema = z.object({ runId: id, ownerDeviceId: id, parentRef: id, expectedRevision: version,
  projectionKind: z.literal("run") }).strict();
export const workflowAttentionBindingSchema = z.object({ ownerDeviceId: id, expectedRevision: version, pendingCount: version.max(1_000) }).strict();
export const workflowBindingBindingSchema = z.object({ projectId: id, ownerDeviceId: id, schemaVersion: z.literal(1), expectedRevision: version,
  stateClass: z.enum(["draft", "enabled", "disabled", "suspended"]) }).strict();
/* An App's build status (U06-d, purpose 13 beside the binding projection): bound to its App, owner desktop and revision, so one App's
   row cannot be served under another App or owner, nor an older revision replayed. */
export const appBuildStatusBindingSchema = z.object({ appId: id, ownerDeviceId: id, expectedRevision: version }).strict();
/* Resource commands (P13 §10.1, purposes 10 / 11): routing, class and criticality are authenticated, so a server cannot
   re-address a command, and a sender cannot take a reserved control slot for an action the owner does not call critical. */
export const resourceCommandBindingSchema = z.object({ protocolVersion: version.positive(), sourceDeviceId: id, targetDeviceId: id,
  resourceKind: z.enum(["project", "provider-quota", "workflow-run", "workflow-binding", "app", "preview", "plugin"]), resourceId: id, commandClass: z.enum(["read", "control", "work"]),
  critical: z.boolean(), expiresAt: version }).strict();
export const resourceResultBindingSchema = resourceCommandBindingSchema.extend({ commandCiphertextHash: digest, resultRevision: version.positive(),
  state: z.enum(["accepted", "succeeded", "refused", "unknown"]) }).strict();

export const memoryControlBindingSchema = z.object({ sourceDeviceId: id, targetDeviceId: id, revision: version.positive(), protocolVersion: version.positive() }).strict();
export const memoryControlResultBindingSchema = memoryControlBindingSchema.extend({ requestHash: digest, state: z.enum(["applied", "refused"]) });
