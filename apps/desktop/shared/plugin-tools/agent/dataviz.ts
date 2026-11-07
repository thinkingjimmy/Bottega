/**
 * [INPUT]: Zod and the shared read-only built-in tool contract.
 * [OUTPUT]: Closed palette inputs, bounded report schema and independent validate_palette tool specification.
 * [POS]: Skills-domain data-visualization validation contract; independent of Artifact/editor authority.
 */
import { z } from "zod";
import { read, type PluginToolSpec } from "../platform";
const color = z.string().regex(/^#?[a-f\d]{6}$/i).transform(value => "#" + value.replace(/^#/, "").toLowerCase());
export const paletteInputSchema = z.object({
  palette: z.array(color).min(1).max(64), mode: z.enum(["light", "dark"]).default("light"),
  surface: color.optional(), pairs: z.enum(["adjacent", "all"]).default("adjacent"), ordinal: z.boolean().default(false),
}).strict();
export const paletteReportSchema = z.object({
  schemaVersion: z.literal(1), palette: z.array(z.string().regex(/^#[a-f\d]{6}$/)).min(1).max(64),
  mode: z.enum(["light", "dark"]), surface: z.string().regex(/^#[a-f\d]{6}$/),
  pairs: z.enum(["adjacent", "all"]), ordinal: z.boolean(), inputDigest: z.string().regex(/^[a-f\d]{64}$/),
  script: z.object({ version: z.literal("baoyu-design-2.7.1"), gitBlob: z.string().regex(/^[a-f\d]{40}$/), sha256: z.string().regex(/^[a-f\d]{64}$/) }).strict(),
  rules: z.array(z.object({ name: z.string().max(120), status: z.enum(["PASS", "WARN", "FAIL"]), detail: z.string().max(16_384) }).strict()).min(1).max(16),
  status: z.enum(["PASS", "WARN", "FAIL"]), exitStatus: z.union([z.literal(0), z.literal(1)]),
}).strict();
export const DATAVIZ_TOOL_SPECS = [{
  name: "validate_palette", domainId: "skills", access: "read",
  description: "Validate the actual chart palette, light/dark mode, chart surface and adjacent/all color pairs with the fixed dataviz JavaScript validator on bundled Node. Read the dataviz Skill before chart code or colors. Returns per-rule PASS/WARN/FAIL, exact inputs/digests and process exit status. WARN is not PASS. Does not validate data, layout or interaction; requires no Artifact editor or Python.",
  inputSchema: paletteInputSchema,
  wireInputSchema: z.object({ palette: z.array(z.string().regex(/^#?[a-f\d]{6}$/i)).min(1).max(64),
    mode: z.enum(["light", "dark"]).default("light"), surface: z.string().regex(/^#?[a-f\d]{6}$/i).optional(),
    pairs: z.enum(["adjacent", "all"]).default("adjacent"), ordinal: z.boolean().default(false) }).strict(),
  annotations: read,
}] as const satisfies readonly PluginToolSpec[];
