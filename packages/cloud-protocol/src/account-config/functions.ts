/**
 * [INPUT]: Depends on the current authenticated encrypted business header and the closed account-config DTOs.
 * [OUTPUT]: Provides the CAS apply mutation, the head read and the small watched revision query.
 * [POS]: Public account-config function registry shared by the service, the desktop coordinator and contract audits.
 */
import { encryptedBusinessHeaderSchema as header } from "../spaces";
import { accountConfigIdentitySchema, accountConfigReceiptSchema, accountConfigRevisionSchema, encryptedAccountConfigSchema } from "./model";
const target = header.extend(accountConfigIdentitySchema.shape).strict();
export const accountConfigFunctions = {
  "accountConfig/sync:apply": { kind: "mutation", args: header.extend({ record: encryptedAccountConfigSchema }).strict(), result: accountConfigReceiptSchema },
  "accountConfig/sync:head": { kind: "query", args: target, result: encryptedAccountConfigSchema.nullable() },
  /* Subscribed: one integer per config, so a change notification never ships the ciphertext. 0 means absent. */
  "accountConfig/sync:revision": { kind: "query", args: target, result: accountConfigRevisionSchema },
} as const;
