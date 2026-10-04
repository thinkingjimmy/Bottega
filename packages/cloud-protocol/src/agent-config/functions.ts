/**
 * [INPUT]: Depends on the encrypted business header and the Agent-configuration model.
 * [OUTPUT]: Provides four public contracts: `agentConfigs/sync:apply` (CAS / tombstone mutation), the subscribed `directory` and `heads` reads, and `get` for one payload.
 * [POS]: Agent-configuration function registry, spread into the shared cloud function registry.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as header } from "../spaces";
import { id } from "../encryption/domains/scalars";
import { agentConfigDirectorySchema, agentConfigHeadsPageSchema, agentConfigReceiptSchema, encryptedAgentConfigSchema } from "./model";
export const agentConfigFunctions = {
  "agentConfigs/sync:apply": { kind: "mutation", args: header.extend({ record: encryptedAgentConfigSchema }).strict(), result: agentConfigReceiptSchema },
  /* Subscribed: one row, so any change costs one small read; the heads page is read only when its revision moved. */
  "agentConfigs/sync:directory": { kind: "query", args: header, result: agentConfigDirectorySchema },
  "agentConfigs/sync:heads": { kind: "query", args: header.extend({ cursor: z.string().max(2048).nullable() }).strict(), result: agentConfigHeadsPageSchema },
  "agentConfigs/sync:get": { kind: "query", args: header.extend({ configId: id }).strict(), result: encryptedAgentConfigSchema.nullable() },
} as const;
