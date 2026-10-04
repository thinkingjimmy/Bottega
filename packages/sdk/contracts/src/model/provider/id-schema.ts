/**
 * [INPUT]: Zod and the dependency-free Provider identity grammar.
 * [OUTPUT]: providerIdSchema and the ProviderId type.
 * [POS]: Narrow schema leaf; validates identity without constructing Provider descriptors.
 */
import { z } from "zod";
import { PROVIDER_ID_PATTERN } from "./id";
export type { ProviderId } from "./id";
export const providerIdSchema = z.string().regex(PROVIDER_ID_PATTERN);
