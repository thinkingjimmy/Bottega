/**
 * [INPUT]: zod's global configuration.
 * [OUTPUT]: configureJitlessZod: switches zod to its interpreter so no `new Function` probe runs.
 * [POS]: Called by the surface wrapper and by Cloud Web's first import in each zod realm (neither CSP has 'unsafe-eval'); exposed here because
 *        both resolve zod only through this package.
 */
import { z } from "zod";
export function configureJitlessZod() { z.config({ jitless: true }); }
