/**
 * [INPUT]: Depends on the protocol header, cloud identifiers and the push scalars in ./index.
 * [OUTPUT]: Native register and browser webConfig/registerWeb, shared confirmation/removal/category contracts and installation ownership results.
 * [POS]: Push slice of the public function registry; only a live mobile device session of the account may call it.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
import { cloudIdSchema } from "../auth/index";
import { webPushEndpointSchema, webPushSubscriptionSchema } from "./browser";
import { expoPushTokenSchema, pushCategoriesSchema, pushChallengeNonceSchema, pushInstallProofSchema, pushLocaleSchema, pushPlatformSchema,
  pushRegisterResultSchema, pushRegistrationSchema } from "./index";
const scope = { ...protocolHeaderSchema.shape, expectedUserId: cloudIdSchema };
export const pushFunctions = {
  "push:webConfig": { kind: "query", args: z.object(scope).strict(), result: z.object({ publicKey: z.string().nullable() }).strict() },
  "push:registerWeb": { kind: "mutation", args: z.object({ ...scope, subscription: webPushSubscriptionSchema,
    locale: pushLocaleSchema, categories: pushCategoriesSchema, installProof: pushInstallProofSchema }).strict(), result: pushRegisterResultSchema },
  "push:register": { kind: "mutation", args: z.object({ ...scope, token: expoPushTokenSchema, platform: pushPlatformSchema,
    locale: pushLocaleSchema, categories: pushCategoriesSchema, installProof: pushInstallProofSchema.optional() }).strict(), result: pushRegisterResultSchema },
  "push:confirm": { kind: "mutation", args: z.object({ ...scope, token: z.union([expoPushTokenSchema, webPushEndpointSchema]), nonce: pushChallengeNonceSchema }).strict(), result: pushRegistrationSchema },
  "push:unregister": { kind: "mutation", args: z.object(scope).strict(), result: z.null() },
  "push:setCategories": { kind: "mutation", args: z.object({ ...scope, categories: pushCategoriesSchema }).strict(), result: pushRegistrationSchema },
  "push:get": { kind: "query", args: z.object(scope).strict(), result: pushRegistrationSchema },
} as const;
