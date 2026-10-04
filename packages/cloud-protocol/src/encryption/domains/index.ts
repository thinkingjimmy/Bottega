/**
 * [INPUT]: Strict domain bindings and bounded source/operation identities.
 * [OUTPUT]: Closed domain context schema, named constructors and typed allowed-metadata helpers.
 * [POS]: Pure server-safe owner of every cleartext AAD field; no generic dictionary extension point.
 */
import { z } from "zod";
import { checked, id, scopeSchema } from "./scalars";
import { skillHeadBindingSchema, skillGenerationBindingSchema, appSurfaceGenerationBindingSchema, pluginSurfaceGenerationBindingSchema, appBindingSchema, chatBindingSchema, projectBindingSchema, accountConfigBindingSchema, agentConfigurationBindingSchema,
  workflowAttentionBindingSchema, workflowBindingBindingSchema, workflowRunBindingSchema, appBuildStatusBindingSchema, resourceCommandBindingSchema, resourceResultBindingSchema, memoryControlBindingSchema, memoryControlResultBindingSchema } from "./records";
import { baseFieldBindingSchema, baseOperationBindingSchema } from "./bases";
import { messageBindingSchema } from "./messages";
import { fileBindingSchema, homeBindingSchema, remoteProjectQueryBindingSchema, remoteCommandBindingSchema, remoteIntentBindingSchema, remoteCreationBindingSchema, remoteMemoryBindingSchema, remoteResultBindingSchema, turnBindingSchema } from "./streams";
import { mirrorBindingSchema } from "./mirror";
import { searchBindingSchema } from "./search";
const shape = <K extends string, P extends number, S extends z.ZodType>(entityKind: K, purpose: P, binding: S) =>
  z.object({ ...scopeSchema.shape, purpose: z.literal(purpose), entityKind: z.literal(entityKind), entityId: id, operationId: id, binding }).strict();
const chat = shape("chat", 1, chatBindingSchema), project = shape("project", 1, projectBindingSchema), app = shape("app", 1, appBindingSchema);
const baseOperation = shape("base-operation", 1, baseOperationBindingSchema), baseField = shape("base-field", 1, baseFieldBindingSchema);
const message = shape("message", 1, messageBindingSchema).refine(value => value.entityId === value.binding.membership.messageId);
const file = shape("file", 3, fileBindingSchema), home = shape("home", 1, homeBindingSchema), turn = shape("turn", 2, turnBindingSchema);
const remoteProjectQuery = shape("remote-project-query", 4, remoteProjectQueryBindingSchema);
const remoteCreation = shape("remote-create", 1, remoteCreationBindingSchema).refine(value => value.entityId === value.operationId);
const remotePlugins = shape("remote-plugins", 1, remoteMemoryBindingSchema).refine(value => value.entityId === value.binding.publicationId && value.operationId === value.entityId);
const remoteMemory = shape("remote-memory", 1, remoteMemoryBindingSchema).refine(value => value.entityId === value.binding.publicationId && value.operationId === value.entityId);
const remoteIntent = shape("remote-intent", 4, remoteIntentBindingSchema).refine(value => value.entityId === value.binding.intentId && value.operationId === value.entityId);
const remoteCommand = shape("remote-command", 4, remoteCommandBindingSchema), remoteResult = shape("remote-result", 5, remoteResultBindingSchema);
const search = shape("search", 6, searchBindingSchema), mirror = shape("mirror", 6, mirrorBindingSchema);
const generation = <K extends string, S extends z.ZodType<{ generationId: string }>>(entityKind: K, binding: S) =>
  shape(entityKind, 3, binding).refine(value => (value as { entityId: string }).entityId === (value as { binding: { generationId: string } }).binding.generationId);
const skillHead = shape("skill-head", 1, skillHeadBindingSchema), skillGeneration = generation("skill-generation", skillGenerationBindingSchema);
const appSurfaceGeneration = generation("app-surface-generation", appSurfaceGenerationBindingSchema);
const pluginSurfaceGeneration = generation("plugin-surface-generation", pluginSurfaceGenerationBindingSchema);
const accountConfig = shape("account-config", 8, accountConfigBindingSchema);
const agentConfiguration = shape("agent-configuration", 9, agentConfigurationBindingSchema);
const workflowRun = shape("workflow-run", 12, workflowRunBindingSchema).refine(value => value.entityId === value.binding.runId);
const workflowAttention = shape("workflow-attention", 12, workflowAttentionBindingSchema).refine(value => value.entityId === value.binding.ownerDeviceId);
const workflowBinding = shape("workflow-binding", 13, workflowBindingBindingSchema);
const appBuildStatus = shape("app-build-status", 13, appBuildStatusBindingSchema).refine(value => value.entityId === value.binding.appId);
const resourceCommand = shape("resource-command", 10, resourceCommandBindingSchema).refine(value => value.entityId === value.operationId);
const resourceResult = shape("resource-result", 11, resourceResultBindingSchema).refine(value => value.entityId === value.operationId);
const memoryControl = shape("memory-control", 10, memoryControlBindingSchema).refine(value => value.entityId === value.operationId);
const memoryControlResult = shape("memory-control-result", 11, memoryControlResultBindingSchema).refine(value => value.entityId === value.operationId);
export const domainContextSchema = z.discriminatedUnion("entityKind", [remoteProjectQuery, chat, project, app, baseOperation, baseField, message, file, home, turn, remoteCreation, remoteMemory, remotePlugins, remoteIntent, remoteCommand, remoteResult, search, mirror, skillHead, skillGeneration, accountConfig, agentConfiguration,
  workflowRun, workflowAttention, workflowBinding, appBuildStatus, resourceCommand, resourceResult, memoryControl, memoryControlResult, appSurfaceGeneration, pluginSurfaceGeneration]);
export type DomainContext = z.infer<typeof domainContextSchema>;
type Scope = z.infer<typeof scopeSchema>;
const constructor = <S extends z.ZodType<DomainContext>>(schema: S, entityKind: z.output<S>["entityKind"], purpose: z.output<S>["purpose"]) =>
  (scope: Scope, entityId: string, operationId: string, binding: z.output<S>["binding"]): z.output<S> =>
    checked(schema, { ...checked(scopeSchema, scope), purpose, entityKind, entityId, operationId, binding });
export const createRemoteProjectQueryContext = constructor(remoteProjectQuery, "remote-project-query", 4);
export const createChatContext = constructor(chat, "chat", 1);
export const createProjectContext = constructor(project, "project", 1);
export const createAppContext = constructor(app, "app", 1);
export const createBaseOperationContext = constructor(baseOperation, "base-operation", 1);
export const createBaseFieldContext = constructor(baseField, "base-field", 1);
export const createMessageContext = constructor(message, "message", 1);
export const createFileContext = constructor(file, "file", 3);
export const createHomeContext = constructor(home, "home", 1);
export const createTurnContext = constructor(turn, "turn", 2);
export const createRemoteCreationContext = constructor(remoteCreation, "remote-create", 1);
export const createRemotePluginsContext = constructor(remotePlugins, "remote-plugins", 1);
export const createRemoteMemoryContext = constructor(remoteMemory, "remote-memory", 1);
export const createRemoteIntentContext = constructor(remoteIntent, "remote-intent", 4);
export const createRemoteCommandContext = constructor(remoteCommand, "remote-command", 4);
export const createRemoteResultContext = constructor(remoteResult, "remote-result", 5);
export const createSkillHeadContext = constructor(skillHead, "skill-head", 1);
export const createSkillGenerationContext = constructor(skillGeneration, "skill-generation", 3);
export const createPluginSurfaceGenerationContext = constructor(pluginSurfaceGeneration, "plugin-surface-generation", 3);
export const createAppSurfaceGenerationContext = constructor(appSurfaceGeneration, "app-surface-generation", 3);
export const createMirrorContext = constructor(mirror, "mirror", 6);
export const createSearchContext = constructor(search, "search", 6);
export const createAccountConfigContext = constructor(accountConfig, "account-config", 8);
export const createAgentConfigurationContext = constructor(agentConfiguration, "agent-configuration", 9);
export const createWorkflowRunContext = constructor(workflowRun, "workflow-run", 12);
export const createWorkflowAttentionContext = constructor(workflowAttention, "workflow-attention", 12);
export const createWorkflowBindingContext = constructor(workflowBinding, "workflow-binding", 13);
export const createAppBuildStatusContext = constructor(appBuildStatus, "app-build-status", 13);
export const createResourceCommandContext = constructor(resourceCommand, "resource-command", 10);
export const createResourceResultContext = constructor(resourceResult, "resource-result", 11);
export * from "./records";
export * from "./bases";
export * from "./messages";
export * from "./streams";
export * from "./search";

export * from "./mirror";

export const createMemoryControlContext = constructor(memoryControl, "memory-control", 10);
export const createMemoryControlResultContext = constructor(memoryControlResult, "memory-control-result", 11);
