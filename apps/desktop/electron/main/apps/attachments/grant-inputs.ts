/**
 * [INPUT]: Depends on zod, shared Apps grant DTO and Project id pattern
 * [OUTPUT]: Provides grant/default/state/target/available strict assertions; All authorized IPCs are pre-analyzed and re-accounted
 * [POS]: The renderer of apps/attachments is entered; Durable authority does not accept type statements or broad objects
 */

import { z } from "zod";
import type {
  AppGrantTarget,
  AppSurfaceAcquireInput,
  AvailableAppsInput,
  SetAppGrantInput,
  SetAppGrantStateInput,
  SetDefaultAppGrantInput,
} from "../../../../shared/apps-ipc";
import { PROJECT_ID_PATTERN } from "../../../../shared/projects-ipc";

const appId = z.string().regex(/^[a-z0-9]{10}$/);
const chatId = z.string().min(1).max(128);
const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), chatId }).strict(),
  z
    .object({
      kind: z.literal("project"),
      projectId: z.string().regex(PROJECT_ID_PATTERN),
    })
    .strict(),
]);
const setGrant = z
  .object({
    target,
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
  z.object({ target, appId, state: z.literal("disabled") }).strict(),
  z.object({ target, appId, state: z.literal("clear") }).strict(),
  z.object({ target, appId, state: z.literal("grant"), ...grantPayload.shape }).strict(),
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
const surface = available.extend({ appId });

export const assertSetAppGrantInput = (value: unknown) =>
  setGrant.parse(value) as SetAppGrantInput;
export const assertSetAppGrantStateInput = (value: unknown) =>
  setGrantState.parse(value) as SetAppGrantStateInput;
export const assertSetDefaultAppGrantInput = (value: unknown) =>
  setDefaultGrant.parse(value) as SetDefaultAppGrantInput;
export const assertAppGrantTarget = (value: unknown) =>
  target.parse(value) as AppGrantTarget;
export const assertAvailableAppsInput = (value: unknown) =>
  available.parse(value) as AvailableAppsInput;
export const assertAppSurfaceAcquireInput = (value: unknown) =>
  surface.parse(value) as AppSurfaceAcquireInput;
export const assertSurfaceLeaseId = (value: unknown) => z.string().uuid().parse(value);
