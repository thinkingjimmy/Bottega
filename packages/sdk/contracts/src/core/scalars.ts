/**
 * [INPUT]: Depends on Zod only.
 * [OUTPUT]: Provides `id`, the opaque identifier scalar every contract and the private protocol share.
 * [POS]: Contract scalars; the private encryption domains re-export `id` instead of defining their own.
 */
import { z } from "zod";

export const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-][A-Za-z0-9._:-]*$/);
