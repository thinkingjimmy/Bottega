/**
 * [INPUT]: Selected canonical Library root, app control-root identity and portable run/Project identifiers.
 * [OUTPUT]: Owned Workflow execution paths and immutable run markers outside control and business workspace roots.
 * [POS]: Library's local execution domain; run state/custody remain in userData and no synthetic Chat Home is created.
 */
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isUnder, libraryDirectory, libraryObjectId } from "../paths";
import { syncDirectory } from "../../persistence/durable-json";
const MARKER = "execution.json";
export const workflowExecutionPath = (root: string, runId: string) => join(root, "workflows", libraryObjectId(runId), "worktree");
export async function workflowLibraryRoot(root: string | null | undefined, userData: string) {
  if (!root) throw new Error("Workflow execution requires an available Library root");
  const info = await lstat(root), canonical = await realpath(root), control = await realpath(userData);
  if (!info.isDirectory() || info.isSymbolicLink() || canonical !== root) throw new Error("Workflow execution Library root changed");
  if (isUnder(root, control) || isUnder(control, root)) throw new Error("Workflow execution Library/control root overlap");
  return root;
}
export async function verifyWorkflowExecution(root: string, runId: string, projectId: string, workspace: string) {
  if (workspace !== workflowExecutionPath(root, runId)) throw new Error("Workflow execution directory identity changed");
  const parent = dirname(workspace), info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) throw new Error("Workflow execution namespace changed");
  const marker = join(parent, MARKER), metadata = await lstat(marker);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 1024) throw new Error("Workflow execution owner marker changed");
  const value = JSON.parse(await readFile(marker, "utf8"));
  if (value.schemaVersion !== 1 || value.runId !== runId || value.projectId !== projectId || Object.keys(value).sort().join() !== "projectId,runId,schemaVersion")
    throw new Error("Workflow execution owner identity changed");
}
export async function prepareWorkflowExecution(root: string, runId: string, projectId: string, sourceWorkspace: string) {
  libraryObjectId(projectId);
  const workspace = workflowExecutionPath(root, runId);
  if (isUnder(root, sourceWorkspace) || isUnder(workspace, sourceWorkspace) || isUnder(sourceWorkspace, workspace)) throw new Error("Workflow execution cannot be inside the business Project");
  const parent = await libraryDirectory(root, "workflows", runId), marker = join(parent, MARKER);
  try {
    const file = await open(marker, "wx", 0o600);
    try { await file.writeFile(JSON.stringify({ schemaVersion: 1, runId, projectId }) + "\n"); await file.sync(); }
    finally { await file.close(); }
    await syncDirectory(parent);
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
  await verifyWorkflowExecution(root, runId, projectId, workspace);
  return workspace;
}
