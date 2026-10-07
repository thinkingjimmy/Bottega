/**
 * [INPUT]: Zod, canonical hashing and local Git snapshots without paths.
 * [OUTPUT]: Shared branch types, bounded Project Git requests/results and deterministic search pages.
 * [POS]: Project resource contract used by native and browser branch adapters.
 */
import { z } from "zod";
import { hashCanonical } from "../encryption/encoding";

const name = z.string().min(1).max(4096);
const token = z.string().min(1).max(128);
export const gitBranchTargetSchema = z.object({ name, kind: z.enum(["local", "remote"]) }).strict();
export const gitBranchRefSchema = gitBranchTargetSchema.extend({ current: z.boolean() }).strict();
export const gitHeadSchema = z.object({ head: name, detached: z.boolean(), uncommittedFiles: z.number().int().nonnegative() }).strict();
export type GitBranchRef = z.infer<typeof gitBranchRefSchema>;
export type GitBranchTarget = z.infer<typeof gitBranchTargetSchema>;
export type GitHead = z.infer<typeof gitHeadSchema>;
export type GitBranchSnapshot = GitHead & { branches: GitBranchRef[] };
const cursor = z.object({ offset: z.number().int().positive(), revision: token }).strict();
export const projectGitListSchema = z.object({ query: z.string().max(256), cursor: cursor.nullable() }).strict();
export const projectGitCheckoutSchema = z.object({ target: gitBranchTargetSchema, workspaceToken: token }).strict();
export const projectGitCreateSchema = z.object({ name, workspaceToken: token }).strict();
export const projectGitPageSchema = gitHeadSchema.extend({ workspaceToken: token, branches: z.array(gitBranchRefSchema).max(50), nextCursor: cursor.nullable() }).strict();
export type ProjectGitList = z.infer<typeof projectGitListSchema>;
export type ProjectGitPage = z.infer<typeof projectGitPageSchema>;
export type ProjectGitPort = {
  pending?(): boolean;
  listBranches(projectId: string, input: ProjectGitList): Promise<ProjectGitPage | null>;
  checkoutBranch(projectId: string, target: GitBranchTarget, workspaceToken: string): Promise<ProjectGitPage>;
  createBranch(projectId: string, name: string, workspaceToken: string): Promise<ProjectGitPage>;
};
export const PROJECT_GIT_REFUSALS = ["project-git-unavailable", "project-git-changed", "project-git-busy", "project-git-invalid-name",
  "project-git-exists", "project-git-missing", "project-git-checkout-failed", "project-git-create-failed", "project-git-budget"] as const;

/** Leave room inside the 8 KiB resource result for its wrapper and canonical encoding. */
export function projectGitPage(snapshot: GitBranchSnapshot, input: ProjectGitList, workspaceToken: string): ProjectGitPage {
  const { branches: all, ...head } = snapshot;
  const localNames = new Set(all.filter(branch => branch.kind === "local").map(branch => branch.name));
  const query = input.query.trim().toLowerCase();
  const branches = all.filter(branch => (branch.kind === "local" || !localNames.has(branch.name.split("/").slice(1).join("/"))) && branch.name.toLowerCase().includes(query));
  const revision = hashCanonical({ head: head.head, detached: head.detached, branches, workspaceToken });
  if (input.cursor && (input.cursor.revision !== revision || input.cursor.offset >= branches.length)) throw new Error("project-git-changed");
  const page: ProjectGitPage = { ...head, workspaceToken, branches: [], nextCursor: null };
  const start = input.cursor?.offset ?? 0;
  for (let index = start; index < branches.length; index++) {
    const next = { ...page, branches: [...page.branches, branches[index]!], nextCursor: index + 1 < branches.length ? { offset: index + 1, revision } : null };
    if (next.branches.length > 50 || new TextEncoder().encode(JSON.stringify({ ok: true, projectGit: next })).length > 7168) break;
    page.branches = next.branches; page.nextCursor = next.nextCursor;
  }
  if (branches.length > start && !page.branches.length || new TextEncoder().encode(JSON.stringify(page)).length > 7168) throw new Error("project-git-budget");
  return projectGitPageSchema.parse(page);
}
