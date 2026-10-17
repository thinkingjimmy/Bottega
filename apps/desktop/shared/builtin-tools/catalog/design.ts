/**
 * [INPUT]: Zod, narrow shared system parameters and built-in tool platform annotations.
 * [OUTPUT]: Pure check, CAS commit, exact render and scoped system extract/diff/update/bind/compile wire specs.
 * [POS]: apps/desktop/shared/builtin-tools/catalog; Shared Design tool wire truth; rendering authority remains derived from the turn lease in main
 */

import { z } from "zod";
import { mutation, read, type BuiltinToolSpec } from "../platform";
import { designSystemParametersSchema } from "@ai-chat/cloud-protocol/artifacts/design/parameters";

const designCanvasPathSchema = z
  .string()
  .regex(/^design\/[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i);
const documentPath = z.string().regex(/^(?:design|design-systems)\/[a-z0-9][a-z0-9_-]{0,63}$/);
const documentId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const contentDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const systemCommand = designSystemParametersSchema;
const systemEdit = systemCommand.pick({ artifactId: true, requestId: true, expectedRevision: true, readSetDigest: true })
  .required();

export const DESIGN_TOOL_SPECS = [
  { name: "design_check", domainId: "design", access: "read", manualTurnOnly: true,
    description: "Read-only check of a design/<slug>/canvas.json document and its complete local file set. After all your writers have returned completion receipts, wait for 1s quiet at 500ms intervals, at most 10s. Return bounded issues, readSetDigest and current revision; never register or publish. Structure does not prove visual or JavaScript correctness.",
    inputSchema: z.object({ path: documentPath }).strict(), annotations: read },
  { name: "design_commit", domainId: "design", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "The only design document publication entry. Commit a checked complete file set to the current Chat/workspace using revision CAS. SOURCE_CHANGED commits nothing: recheck after writer completion; retry at most twice after 1s and 2s with new request IDs. REVISION_CONFLICT must be reported. Unknown or pending result: resend exactly the same parameters and requestId, at most three times 500ms apart; never create a second commit. Returns one complete archive Artifact v1 file reference.",
    inputSchema: z.object({ path: documentPath, requestId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
      expectedRevision: z.number().int().min(0), readSetDigest: contentDigest }).strict(), annotations: mutation },
  {
    name: "design_render_check",
    domainId: "design",
    access: "read",
    planExcluded: true,
    description:
      "Render a complete single HTML file or an exact committed document/board revision in an offline opaque sandbox. Return a JPEG and actual source/file-set digests. Inspect the returned image before claiming visual completion. Runtime errors and timeouts return failure with bounded symptoms; never infer visual or interaction success from structure alone.",
    inputSchema: z.object({
      file: designCanvasPathSchema.optional(), documentId: documentId.optional(), revision: z.number().int().positive().optional(),
      boardId: documentId.optional(), viewport: z.enum(["desktop", "tablet", "mobile"]).optional(),
    }).strict().superRefine((value, context) => {
      if (value.file ? value.documentId || value.revision || value.boardId : !value.documentId || !value.revision)
        context.addIssue({ code: "custom", message: "Use file, or documentId and revision with an optional boardId" });
    }),
    annotations: read,
  },
  { name: "design_system_extract", domainId: "design", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Read precise CSS/JSON tokens and real component source inventory inside this Chat's authorized workspace. No remote fetch or dependency install. Without save, return bounded provenance and all unsynced items; save:true creates only a new design-systems/<systemId> document through the same check/commit journal. Requires expectedRevision:0 and original requestId. Never overwrite an existing system.",
    inputSchema: systemCommand.pick({ systemId: true, sources: true, save: true, requestId: true, expectedRevision: true, value: true }).required({ systemId: true, sources: true }).strict(), annotations: mutation },
  { name: "design_system_diff", domainId: "design", access: "read", manualTurnOnly: true,
    description: "Compare an exact system Artifact with explicit current sources. Return digest-bound difference pages and every unsynced item. Use value JSON {cursor,unsyncedCursor} to read later pages; summaries are bounded, archived source values remain exact. Does not update or delete anything.",
    inputSchema: systemCommand.pick({ artifactId: true, sources: true, value: true }).required({ artifactId: true, sources: true }).strict(), annotations: read },
  { name: "design_system_update", domainId: "design", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Update one current design system through revision/read-set CAS. Supply sources/sourceDigest and explicit keep/source/delete decisions for all conflicts and removals, or value JSON {token,theme,value,usage?} for one user override. Recompute the full difference before effect; preserve conflicts and exact source values. Unknown/pending: recover the original request, never make a second update.",
    inputSchema: systemEdit.extend(systemCommand.pick({ sources: true, sourceDigest: true, decisions: true, value: true }).shape).strict(), annotations: mutation },
  { name: "design_system_bind", domainId: "design", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Bind a current design Artifact to an exact current-Chat systemId/targetRevision and freeze its complete bounded closure through the same revision journal. Existing consumers keep their recorded system snapshot until an explicit new bind.",
    inputSchema: systemEdit.extend(systemCommand.pick({ systemId: true, targetRevision: true }).required().shape).strict(), annotations: mutation },
  { name: "design_system_compile", domainId: "design", access: "mutate", manualTurnOnly: true, planExcluded: true,
    description: "Build one captured component source entry using only the locked local React/esbuild runtime. Use value JSON {component,props?}. Deny out-of-closure modules and remote resources. Verify an actual sandbox mount; persist an explicit static failure when mounting fails, never claim static output is live.",
    inputSchema: systemEdit.extend(systemCommand.pick({ entry: true, value: true }).required().shape).strict(), annotations: mutation },
] as const satisfies readonly BuiltinToolSpec[];
