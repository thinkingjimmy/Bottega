/**
 * [INPUT]: Depends only on Zod numeric validation.
 * [OUTPUT]: Provides the safe nonnegative integer versionSchema used across protocol domains.
 * [POS]: Dependency-free scalar boundary; callers do not load Base operation schemas.
 */
import { z } from "zod";
export const versionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
