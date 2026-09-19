/**
 * [INPUT]: Depends on portable App identities, local Agent selection and explicit delivery authorization.
 * [OUTPUT]: Defines the immutable fixed-identity install journal input and its local binding baseline.
 * [POS]: Main-only lifecycle schema; synchronized data never carries executable local authority.
 */
import { z } from "zod";
import { syncScopeSchema, storageIdSchema, storageRevisionSchema } from "../../../../../shared/local-storage/contracts";
import { agentBackendIdSchema } from "../../../../../shared/agent-schema";
import { publishedAppDescriptorSchema } from "../../store/portable/model";
import { extensionFulfillmentSchema, installAuthorizationSchema } from "../delivery/contract";
export const cloudAppInstallSchema = z.object({ scope: syncScopeSchema, descriptor: publishedAppDescriptorSchema,
  agent: agentBackendIdSchema, authorization: installAuthorizationSchema, extensionFulfillment: extensionFulfillmentSchema,
  previousGenerationId: storageIdSchema.nullable(), previousBindingRevision: storageRevisionSchema,
}).strict();
export type CloudAppInstall = z.infer<typeof cloudAppInstallSchema>;
