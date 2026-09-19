/**
 * [INPUT]: Depends on current protocol headers, exact session/device identities and immutable space descriptors.
 * [OUTPUT]: Provides a subscribable get query and a closed rate-limited create-if-absent mutation without update, reset or secret endpoints.
 * [POS]: Space RPC registry; authenticated null is the only representation of confirmed absence.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
import { cloudIdSchema } from "../auth";
import { keyPackageSchema, spaceCreateResultSchema, spaceDescriptorSchema } from "./model";
const spaceRequestSchema = z.object({ ...protocolHeaderSchema.shape, expectedUserId: cloudIdSchema,
  expectedSessionId: cloudIdSchema, expectedDeviceId: cloudIdSchema }).strict();
export const spacesFunctions = {
  "spaces/api:get": { kind: "query", args: spaceRequestSchema, result: spaceDescriptorSchema.nullable() },
  "spaces/api:createIfAbsent": { kind: "mutation", args: spaceRequestSchema.extend({
    createOperationId: spaceDescriptorSchema.shape.createOperationId, keyPackage: keyPackageSchema,
  }).strict(), result: spaceCreateResultSchema },
} as const;
export type SpaceRequest = z.infer<typeof spaceRequestSchema>;
export type SpaceCreateRequest = z.infer<(typeof spacesFunctions)["spaces/api:createIfAbsent"]["args"]>;
