/**
 * [INPUT]: Zod and the canonical Zod-free SDK built-in Provider identities.
 * [OUTPUT]: The single closed agentBackendIdSchema object reused by options and encrypted business domains.
 * [POS]: Lightweight portable Agent identity validation; imports no Chat options or mode snapshots.
 */
import { z } from "zod";
import { BUILTIN_PROVIDER_IDS } from "../backend-id";
export const agentBackendIdSchema = z.enum(BUILTIN_PROVIDER_IDS);
