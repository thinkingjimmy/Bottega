/**
 * [INPUT]: Depends on zod and builtin-tools/platform read annotations/spec
 * [OUTPUT]: Provides the design_render_check built-in MCP contract with canonical canvas and viewport inputs
 * [POS]: Shared Design tool wire truth; rendering authority remains derived from the turn lease in main
 */

import { z } from "zod";
import { read, type BuiltinToolSpec } from "./platform";

export const designCanvasPathSchema = z
  .string()
  .regex(/^design\/[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i);

export const DESIGN_TOOL_SPECS = [
  {
    name: "design_render_check",
    domainId: "design",
    access: "read",
    planExcluded: true,
    description:
      "Render a registered Design canvas in a hermetic viewport and return a screenshot image plus advisory metadata. Use the image to inspect hierarchy, clipping, responsive layout, and visual quality before claiming completion.",
    inputSchema: z.object({
      file: designCanvasPathSchema,
      viewport: z.enum(["desktop", "tablet", "mobile"]).default("desktop"),
    }).strict(),
    annotations: read,
  },
] as const satisfies readonly BuiltinToolSpec[];
