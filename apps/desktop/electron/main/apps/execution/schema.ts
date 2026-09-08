/**
 * [INPUT]: Depends on zod and the shared App command type
 * [OUTPUT]: Provides one strict structured-command parser and derived JSON Schema
 * [POS]: Execution description admission shared by author manifests and optional Agent analysis
 */

import { z } from "zod";

export const portableCommandPath = z.string().min(1).max(500).refine((value) =>
  value === "." || value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".." &&
    ![...segment].some((character) => character.charCodeAt(0) < 32) && !/[\\:*?"<>|]/.test(segment) && !/[. ]$/.test(segment) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)));
const script = z.object({ path: portableCommandPath.refine((value) => value !== "."),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`) }).strict();
const target = z.object({ runtime: z.enum(["node", "npm", "pnpm", "yarn", "bash", "zsh", "pwsh"]), script: script.optional() })
  .strict().refine((value) => ["node", "bash", "zsh", "pwsh"].includes(value.runtime) === Boolean(value.script), "Shells require a frozen script");
const envKey = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).refine((value) =>
  !/^(PATH|HOME|USERPROFILE|SYSTEMROOT|COMSPEC|PATHEXT|SHELL|TMP|TEMP|TMPDIR|NODE_.*|ELECTRON_.*|LD_.*|DYLD_.*|PYTHON.*|BASH_ENV|ENV|ZDOTDIR)$/i.test(value));

export const structuredAppCommandSchema = z.object({
  schema: z.literal("bottega.app-command/v1"),
  target: z.union([target, z.object({ platforms: z.object({ darwin: target, win32: target, linux: target }).strict() }).strict()]),
  argv: z.array(z.string().max(8192).refine((value) => !value.includes("\0"))).max(128),
  cwd: portableCommandPath,
  env: z.record(envKey, z.union([
    z.object({ config: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,119}$/) }).strict(),
    z.object({ host: z.enum(["PORT", "HOST", "APP_DATA_DIR"]) }).strict(),
  ])).refine((value) => Object.keys(value).length <= 64),
}).strict();

export const appCommandSchema = z.union([z.string().trim().min(1).max(2000), structuredAppCommandSchema]);
// Runtime refinements above supplement this shape at the common admission boundary.
export const APP_COMMAND_JSON_SCHEMA = z.toJSONSchema(appCommandSchema, { unrepresentable: "any", io: "input" });
