/**
 * [INPUT]: Depends on the protocol header, cloud identifiers and the push scalars in ./index.
 * [OUTPUT]: Provides the push:register/unregister/setCategories/get function contracts.
 * [POS]: Push slice of the public function registry; only a live mobile device session of the account may call it.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
import { cloudIdSchema } from "../auth/index";
import { expoPushTokenSchema, pushCategoriesSchema, pushLocaleSchema, pushPlatformSchema, pushRegistrationSchema } from "./index";
const scope = { ...protocolHeaderSchema.shape, expectedUserId: cloudIdSchema };
export const pushFunctions = {
  "push:register": { kind: "mutation", args: z.object({ ...scope, token: expoPushTokenSchema, platform: pushPlatformSchema,
    locale: pushLocaleSchema, categories: pushCategoriesSchema }).strict(), result: pushRegistrationSchema },
  "push:unregister": { kind: "mutation", args: z.object(scope).strict(), result: z.null() },
  "push:setCategories": { kind: "mutation", args: z.object({ ...scope, categories: pushCategoriesSchema }).strict(), result: pushRegistrationSchema },
  "push:get": { kind: "query", args: z.object(scope).strict(), result: pushRegistrationSchema },
} as const;
