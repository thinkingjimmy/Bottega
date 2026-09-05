/**
 * [INPUT]: Depends on zod, the shared Apps grant DTO, the Project id pattern, and app-store-schema APP_ID_PATTERN
 * [OUTPUT]: Provides strict assertions for fenced grant candidates, grant/default/state targets, available-App queries, and staged GUI-ready messages
 * [POS]: Renderer input boundary for apps/attachments; durable authority accepts neither type assertions, broad objects, stale identities, nor malformed cohort nonces
 */

import { z } from "zod";
import type {
  AppGrantCandidatesInput,
  AppGuiInfoInput,
  AppGuiReadyInput,
  AppSurfaceAcquireInput,
  AvailableAppsInput,
  SetAppGrantInput,
  SetAppGrantStateInput,
  SetDefaultAppGrantInput,
} from "../../../../shared/apps-ipc";
import { PROJECT_ID_PATTERN } from "../../../../shared/projects-ipc";
import { APP_ID_PATTERN } from "../store/app-store-schema";

const appId = z.string().regex(APP_ID_PATTERN);
const chatId = z.string().min(1).max(128);
const commandTarget = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chat"),
    chatId,
    expectedConversationIncarnationId: z.string().min(1).max(128),
  }).strict(),
  z.object({
    kind: z.literal("project"),
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    expectedProjectLifecycleRevision: z.number().int().positive(),
  }).strict(),
]);
const setGrant = z
  .object({
    target: commandTarget,
    appId,
    requestedDataLevel: z
      .enum(["none", "read", "row-write"])
      .optional(),
    requestedAgentDelegation: z
      .object({ fileRead: z.boolean(), useData: z.boolean() })
      .strict(),
  })
  .strict();
const grantPayload = z.object({
  requestedDataLevel: z.enum(["none", "read", "row-write"]).optional(),
  requestedAgentDelegation: z
    .object({ fileRead: z.boolean(), useData: z.boolean() })
    .strict(),
}).strict();
const setGrantState = z.discriminatedUnion("state", [
  z.object({ target: commandTarget, appId, state: z.literal("disabled") }).strict(),
  z.object({ target: commandTarget, appId, state: z.literal("clear") }).strict(),
  z.object({ target: commandTarget, appId, state: z.literal("grant"), ...grantPayload.shape }).strict(),
]);
const setDefaultGrant = z.object({
  appId,
  grant: grantPayload.nullable(),
}).strict();
const available = z
  .object({
    conversationId: chatId,
    conversationIncarnationId: z.string().min(1).max(128),
  })
  .strict();
const candidates = z.object({ target: commandTarget }).strict();
const surface = available.extend({
  appId,
  mode: z.enum(["chat-tab", "studio"]),
});
const guiSurface = z
  .object({
    appId,
    surfaceId: z.string().uuid(),
    appSurfaceLeaseId: z.string().uuid(),
  })
  .strict();
const guiReady = guiSurface.extend({
  cutoverId: z.string().uuid(),
  readyNonce: z.string().uuid(),
}).strict();

export const assertSetAppGrantInput = (value: unknown) =>
  setGrant.parse(value) as SetAppGrantInput;
export const assertSetAppGrantStateInput = (value: unknown) =>
  setGrantState.parse(value) as SetAppGrantStateInput;
export const assertSetDefaultAppGrantInput = (value: unknown) =>
  setDefaultGrant.parse(value) as SetDefaultAppGrantInput;
export const assertAvailableAppsInput = (value: unknown) =>
  available.parse(value) as AvailableAppsInput;
export const assertAppGrantCandidatesInput = (value: unknown) =>
  candidates.parse(value) as AppGrantCandidatesInput;
export const assertAppSurfaceAcquireInput = (value: unknown) =>
  surface.parse(value) as AppSurfaceAcquireInput;
export const assertAppGuiInfoInput = (value: unknown) =>
  guiSurface.parse(value) as AppGuiInfoInput;
export const assertAppGuiReadyInput = (value: unknown) =>
  guiReady.parse(value) as AppGuiReadyInput;
export const assertSurfaceLeaseId = (value: unknown) => z.string().uuid().parse(value);
