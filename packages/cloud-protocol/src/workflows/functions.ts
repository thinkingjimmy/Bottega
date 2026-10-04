/**
 * [INPUT]: Depends on the encrypted business header and the workflow projection model.
 * [OUTPUT]: Provides the eight public contracts: `workflows/runs:publish|latestForRows|get`, `workflows/attention:publish|directory`, `workflows/bindings:publish|list` and `workflows/projects:remove`.
 * [POS]: Workflow projection function registry (protocol 13), spread into the shared cloud function registry. Writes come only from the owner desktop; phones and Web read.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as header } from "../spaces";
import { id } from "../encryption/domains/scalars";
import { encryptedWorkflowAttentionSchema, encryptedWorkflowBindingSchema, encryptedWorkflowRunSchema, WORKFLOW_PROJECTION_LIMITS, workflowAttentionPushSchema,
  workflowProjectionReceiptSchema, workflowProjectRemovalSchema, workflowRunHeaderSchema } from "./model";
const L = WORKFLOW_PROJECTION_LIMITS;
export const workflowFunctions = {
  "workflows/runs:publish": { kind: "mutation", args: header.extend({ record: encryptedWorkflowRunSchema }).strict(), result: workflowProjectionReceiptSchema },
  /* A Base view reads each row's newest run header, never a Project's runs. */
  "workflows/runs:latestForRows": { kind: "query", args: header.extend({ projectId: id, rowIds: z.array(id).min(1).max(L.rowsPerRead) }).strict(),
    result: z.object({ items: z.array(workflowRunHeaderSchema).max(L.rowsPerRead) }).strict() },
  "workflows/runs:get": { kind: "query", args: header.extend({ runId: id }).strict(), result: encryptedWorkflowRunSchema.nullable() },
  /* `attention` names the push for an item this write adds (R-34); null when nothing new should notify. */
  "workflows/attention:publish": { kind: "mutation", args: header.extend({ record: encryptedWorkflowAttentionSchema, attention: workflowAttentionPushSchema.nullable() }).strict(),
    result: workflowProjectionReceiptSchema },
  /* The phone's bell subscribes here: one row per desktop, summed for the badge. */
  "workflows/attention:directory": { kind: "query", args: header, result: z.object({ rows: z.array(encryptedWorkflowAttentionSchema).max(L.attentionRows) }).strict() },
  "workflows/bindings:publish": { kind: "mutation", args: header.extend({ record: encryptedWorkflowBindingSchema }).strict(), result: workflowProjectionReceiptSchema },
  /* A deleted or removed Project leaves the phone: its owner desktop clears the Project's runs and bindings, a page per call. */
  "workflows/projects:remove": { kind: "mutation", args: header.extend({ projectId: id, pageSize: z.number().int().min(1).max(100).optional() }).strict(),
    result: workflowProjectRemovalSchema },
  "workflows/bindings:list": { kind: "query", args: header.extend({ projectId: id }).strict(),
    result: z.object({ items: z.array(encryptedWorkflowBindingSchema).max(L.bindingsPerProject) }).strict() },
} as const;
