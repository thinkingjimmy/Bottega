/**
 * [INPUT]: Closed user choices, intent-bound consent and server delivery versions.
 * [OUTPUT]: Private v2 intent serialization and final native payload reconstruction.
 * [POS]: The ciphertext holds choices; execution versions belong to one server delivery.
 */
import { z } from "zod";
import { agentBackendIdSchema } from "../../chats/options";
import { remoteIntentConsentSchema } from "../input/model";
import { remotePayloadSchema, remoteIntentIdentity, type RemoteCommandInput } from "../model";
import type { EncryptedRemoteCommand } from "./model";
const choice = remotePayloadSchema.options[0].omit({ expectedAgentRevision: true, agentSelection: true, fullAccessConsent: true }).extend({
  kind: z.literal("start-turn"),
  agentSelection: z.object({ backend: agentBackendIdSchema }).strict().optional(), fullAccessConsent: remoteIntentConsentSchema.optional(),
}).strict();
export const privateIntentSchema = z.object({ schema: z.literal("bottega.remote-intent/v2"), baselineAgent: agentBackendIdSchema, payload: choice }).strict();
export function privateIntent(input: RemoteCommandInput) {
  return privateIntentSchema.parse({ schema: "bottega.remote-intent/v2", baselineAgent: input.intent?.baselineAgent,
    payload: remoteIntentIdentity(input).payload });
}
export function deliveredIntent(raw: unknown, command: EncryptedRemoteCommand) {
  const value = privateIntentSchema.parse(raw), payload = value.payload;
  return { intent: { baselineAgent: value.baselineAgent }, payload: remotePayloadSchema.parse({ ...payload,
    expectedAgentRevision: command.expectedAgentRevision,
    ...(payload.agentSelection ? { agentSelection: { ...payload.agentSelection, expectedFactRevision: command.expectedChatVersion } } : {}),
  }) };
}
