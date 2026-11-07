/**
 * [INPUT]: Zod primitive validation and the fixed private Workflow ledger location.
 * [OUTPUT]: Strict isolated execution state and ledger path shared by runtime and startup relocation.
 * [POS]: Lightweight private schema leaf; does not open stores, execute Git or load feature owners.
 */
import { join } from "node:path";
import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const workflowWorkspaceSchema = z.object({ runId: id, projectId: id, previousRunId: id.optional(), sourceWorkspace: z.string().min(1), workspace: z.string().min(1),
  libraryRoot: z.string().min(1).optional(), branch: z.string().min(1), baseCommit: z.string().regex(/^[a-f0-9]{40,64}$/), commonDir: z.string().min(1), status: z.enum(["preparing", "ready"]) }).strict();
export const workflowWorkspacesSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(workflowWorkspaceSchema) }).strict();
export type WorkflowWorkspace = z.infer<typeof workflowWorkspaceSchema>;
export const workflowWorkspacesPath = (userData: string) => join(userData, "workflows", "isolation", "workspaces.json");
