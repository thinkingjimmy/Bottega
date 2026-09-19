/**
 * [INPUT]: Depends on strict scope, identity and explicit Studio authorization schemas.
 * [OUTPUT]: Defines frozen local Extension fulfillment and installation authorization inputs.
 * [POS]: Shared lifecycle contract; configuration values and remote-device grants are excluded.
 */
import { z } from "zod";
export const extensionFulfillmentSchema = z.array(z.object({ declaredComponentIdentity: z.string().min(1),
  scope: z.discriminatedUnion("kind", [z.object({ kind: z.literal("global") }).strict(),
    z.object({ kind: z.literal("project"), projectId: z.string().min(1) }).strict()]),
  projectLifecycleRevision: z.number().int().positive().nullable(), scopeRevision: z.number().int().nonnegative(),
  repoUrl: z.string().min(1), requestedRef: z.string(), resolvedCommit: z.string().min(1),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), capabilityDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()).max(64).default([]);
export const installAuthorizationSchema = z.object({ scope: z.literal("studio-only"), decision: z.literal("approve-requested") }).strict();
