/**
 * [INPUT]: Closed encrypted Skills and current authenticated business headers.
 * [OUTPUT]: Catalog change subscriptions, bounded pages, identity CAS and immutable generation publication RPCs.
 * [POS]: Public Skills function registry shared by service, desktop and contract audits.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as header } from "../spaces";
import { digest, version } from "../encryption/domains/scalars";
import { ciphertextFileDescriptorSchema } from "../blobs/encrypted/model";
import { encryptedSkillHeadSchema, skillReceiptSchema, skillGenerationSchema, remoteSkillGenerationSchema, SKILL_LIMITS } from "./model";
import { skillObjectIdSchema as id } from "./identity";
const owner = header.extend({ libraryId: id }).strict();
const generation = owner.extend({ generationId: id }).strict();
export const skillFunctions = {
  "skills/sync:catalog": { kind: "query", args: header, result: z.object({ revision: version }).strict() },
  "skills/sync:apply": { kind: "mutation", args: header.extend({ head: encryptedSkillHeadSchema, generationId: id.nullable() }).strict(), result: skillReceiptSchema },
  "skills/sync:head": { kind: "query", args: owner, result: encryptedSkillHeadSchema.nullable() },
  "skills/sync:slug": { kind: "query", args: header.extend({ slugKey: digest }).strict(), result: encryptedSkillHeadSchema.nullable() },
  "skills/sync:page": { kind: "query", args: header.extend({ afterId: id.nullable() }).strict(),
    result: z.object({ items: z.array(encryptedSkillHeadSchema).max(SKILL_LIMITS.page), cursor: id.nullable(), complete: z.boolean() }).strict() },
  "skills/generations:prepare": { kind: "mutation", args: header.extend({ generation: skillGenerationSchema.omit({ state: true }) }).strict(), result: skillGenerationSchema },
  "skills/generations:attach": { kind: "mutation", args: generation.extend({ ordinal: version.max(SKILL_LIMITS.files), file: ciphertextFileDescriptorSchema }).strict(), result: z.null() },
  "skills/generations:commit": { kind: "mutation", args: generation, result: skillGenerationSchema },
  "skills/generations:page": { kind: "query", args: owner.extend({ afterId: id.nullable() }).strict(),
    result: z.object({ items: z.array(remoteSkillGenerationSchema).max(SKILL_LIMITS.page), cursor: id.nullable(), complete: z.boolean() }).strict() },
} as const;
